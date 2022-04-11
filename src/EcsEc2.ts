import { ComponentResourceOptions, Input, log, Output, Resource } from '@pulumi/pulumi';
import { CloudWatch } from './CloudWatch';
import { lb, ecs, autoscaling, route53, appautoscaling, getCallerIdentity, cloudwatch } from '@pulumi/aws';
import { input as inputs } from '@pulumi/aws/types';

import { CustomComponentResource, CustomComponentResourceOptions } from './Custom';

export interface EcsEc2LoadBalancerHealthCheckOptions {
  path?: Input<string>;
  healthyThreshold?: Input<number>;
  interval?: Input<number>;
  timeout?: Input<number>;
}

interface MetricAlarm {
  action: string;
  comparisonOperator: string;
  threshold: number;
  metricName: string;
  period: number;
  statistic: string;
  stepAdjustment: inputs.appautoscaling.PolicyStepScalingPolicyConfigurationStepAdjustment;
  disable?: boolean;
}

export interface EcsEc2LoadBalancerOptions {
  name: string;
  vpcId: Input<string>;
  priority: number;
  healthCheckOptions?: EcsEc2LoadBalancerHealthCheckOptions;
}

export interface EcsEc2Route53Options {
  domain: string;
  zoneId: Output<string>;
  aliases: string[];
}

export interface EcsEc2TurnOnAndOffScheduleOptions {
  disable?: boolean;
  offSchedule?: {
    schedule: string;
    minCapacity?: Input<number>;
    maxCapacity?: Input<number>;
  };
  onSchedule?: {
    schedule: string;
    minCapacity?: Input<number>;
    maxCapacity?: Input<number>;
  };
}

export interface EcsEc2Options extends CustomComponentResourceOptions {
  name: Input<string>;
  clusterName: string;
  autoScalingGroupName: string;
  loadBalancerOptions?: EcsEc2LoadBalancerOptions;
  route53Options?: EcsEc2Route53Options;
  defaultAlias: string;
  taskDefinition: Input<string>;
  desiredCount: Input<number>;
  minCapacity?: Input<number>;
  maxCapacity?: Input<number>;
  containerName: Input<string>;
  containerPort: Input<number>;
  capacityProviderStrategies?: inputs.ecs.ServiceCapacityProviderStrategy[];
  turnOnAndOffSchedule?: EcsEc2TurnOnAndOffScheduleOptions;
}

export class EcsEc2 extends CustomComponentResource {
  readonly service: ecs.Service;
  readonly cloudwatch: CloudWatch;
  readonly targetGroup?: lb.TargetGroup;
  readonly listenerRule?: lb.ListenerRule;
  readonly autoScalingAttachment?: autoscaling.Attachment;
  readonly appAutoScalingTarget: appautoscaling.Target;
  route53Records?: route53.Record[];

  private lb?: Promise<lb.GetLoadBalancerResult>;
  private cluster: Promise<ecs.GetClusterResult>;
  private autoScalingGroup: Promise<autoscaling.GetGroupResult>;

  constructor(name: string, private readonly options: EcsEc2Options, opts?: ComponentResourceOptions) {
    super('EcsEc2', name, {}, opts);

    this.cluster = ecs.getCluster({ clusterName: this.options.clusterName });
    this.autoScalingGroup = autoscaling.getGroup({ name: this.options.autoScalingGroupName });

    if (this.options.loadBalancerOptions) {
      const loadBalancer = lb.getLoadBalancer({ name: this.options.loadBalancerOptions.name });
      this.lb = loadBalancer;

      if (this.options.route53Options) {
        this.options.route53Options.zoneId.apply((zoneId) => {
          const hostedZone = route53.getZone({
            zoneId: zoneId,
          });

          this.route53Records = this.options.route53Options?.aliases.map(
            (alias, idx) =>
              new route53.Record(
                this.buildName(`record-${idx}`),
                {
                  zoneId: hostedZone.then((zone) => zone.zoneId),
                  name: alias,
                  type: 'CNAME',
                  ttl: 5,
                  records: [loadBalancer.then((lb) => lb.dnsName)],
                },
                this.defaultResourceOptions,
              ),
          );
        });
      }
    }

    this.cloudwatch = this.createCloudWatch();

    this.targetGroup = this.createTargetGroup();
    this.listenerRule = this.createListenerRule();
    this.autoScalingAttachment = this.createAutoScalingAttachment();

    const loadBalancers: inputs.ecs.ServiceLoadBalancer[] = [];
    if (this.options.loadBalancerOptions) {
      loadBalancers.push({
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        targetGroupArn: this.targetGroup!.arn,
        containerName: this.options.containerName,
        containerPort: this.options.containerPort,
      });
    }

    const dependsOn = [this.cloudwatch] as Input<Resource>[];
    if (this.targetGroup) {
      dependsOn.push(this.targetGroup);
    }
    if (this.listenerRule) {
      dependsOn.push(this.listenerRule);
    }
    if (this.autoScalingAttachment) {
      dependsOn.push(this.autoScalingAttachment);
    }
    this.service = new ecs.Service(
      this.buildName('service'),
      {
        name: this.options.name,
        cluster: this.cluster.then((cluster) => cluster.id),
        taskDefinition: this.options.taskDefinition,
        desiredCount: this.options.desiredCount,
        forceNewDeployment: true,
        launchType: this.options.capacityProviderStrategies?.length ? undefined : 'EC2',
        propagateTags: 'SERVICE',
        waitForSteadyState: false,
        healthCheckGracePeriodSeconds: 60,
        loadBalancers,
        capacityProviderStrategies: this.options.capacityProviderStrategies,
        deploymentCircuitBreaker: {
          enable: true,
          rollback: true,
        },
        deploymentController: {
          type: 'ECS',
        },
        tags: this.options.tags,
      },
      {
        ...this.defaultResourceOptions,
        ignoreChanges: ['desiredCount'],
        dependsOn,
      },
    );

    const current = getCallerIdentity(this.defaultResourceOptions);
    const roleArn = current.then(
      (c) =>
        `arn:aws:iam::${c.accountId}:role/aws-service-role/ecs.application-autoscaling.amazonaws.com/AWSServiceRoleForApplicationAutoScaling_ECSService`,
    );

    this.appAutoScalingTarget = new appautoscaling.Target(
      this.buildName('ecs-target'),
      {
        minCapacity: this.options.minCapacity || 1,
        maxCapacity: this.options.maxCapacity || 2,
        resourceId: `service/${this.options.clusterName}/${this.options.name.toString()}`,
        roleArn,
        scalableDimension: 'ecs:service:DesiredCount',
        serviceNamespace: 'ecs',
      },
      { ...this.defaultResourceOptions, dependsOn: this.service },
    );

    this.metricAlarms.reduce(
      (a, { metricName, action, stepAdjustment, disable, comparisonOperator, period, statistic, threshold }, idx) => {
        if (!disable) {
          const policy = this.createAppAutoScalingPolicy(
            this.buildName(`autoscaling-policy-${idx}`),
            metricName,
            action,
            stepAdjustment,
          );
          const metricAlarm = this.createCloudWatchMetricAlarm(
            this.buildName(`metric-alarm-${idx}`),
            metricName,
            action,
            policy.arn,
            comparisonOperator,
            period,
            statistic,
            threshold,
          );
          a.push([policy, metricAlarm]);
        }
        return a;
      },
      [] as [appautoscaling.Policy, cloudwatch.MetricAlarm][],
    );

    this.createTurnOnAndOffSchedule();

    this.registerOutputs();
  }

  private get metricAlarms(): MetricAlarm[] {
    return [
      {
        action: 'down',
        comparisonOperator: 'LessThanThreshold',
        threshold: 40,
        metricName: 'CPUUtilization',
        period: 300,
        statistic: 'Average',
        stepAdjustment: {
          scalingAdjustment: -1,
          metricIntervalUpperBound: '0',
        },
        disable: false,
      },
      {
        action: 'up',
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        threshold: 70,
        metricName: 'CPUUtilization',
        period: 60,
        statistic: 'Average',
        stepAdjustment: {
          scalingAdjustment: 1,
          metricIntervalLowerBound: '1',
        },
        disable: false,
      },
      {
        action: 'down',
        comparisonOperator: 'LessThanThreshold',
        threshold: 40,
        metricName: 'MemoryUtilization',
        period: 300,
        statistic: 'Average',
        stepAdjustment: {
          scalingAdjustment: -1,
          metricIntervalUpperBound: '0',
        },
        disable: true,
      },
      {
        action: 'up',
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        threshold: 70,
        metricName: 'MemoryUtilization',
        period: 60,
        statistic: 'Average',
        stepAdjustment: {
          scalingAdjustment: 1,
          metricIntervalLowerBound: '1',
        },
        disable: true,
      },
    ];
  }

  createCloudWatch(): CloudWatch {
    return new CloudWatch(
      this.buildName('cloudwatch'),
      {
        name: this.options.name,
        tags: this.options.tags,
      },
      this.defaultResourceOptions,
    );
  }

  createTargetGroup(): lb.TargetGroup | undefined {
    if (!this.options.loadBalancerOptions) {
      return undefined;
    }

    let healthCheck: inputs.lb.TargetGroupHealthCheck | undefined = undefined;
    if (this.options.loadBalancerOptions.healthCheckOptions) {
      const { healthyThreshold, interval, path, timeout } = this.options.loadBalancerOptions?.healthCheckOptions;
      healthCheck = {
        path,
        interval,
        timeout,
        healthyThreshold,
      };
    }

    return new lb.TargetGroup(
      this.buildName('target-group'),
      {
        name: this.options.name,
        vpcId: this.options.loadBalancerOptions.vpcId,
        port: 80,
        protocol: 'HTTP',
        healthCheck,
        tags: this.options.tags,
      },
      this.defaultResourceOptions,
    );
  }

  createListenerRule(): lb.ListenerRule | undefined {
    if (!this.options.loadBalancerOptions) {
      return undefined;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const listenerArn = this.lb!.then((l) => lb.getListener({ port: 443, loadBalancerArn: l.arn })).then(
      (listener) => listener.arn,
    );

    return new lb.ListenerRule(
      this.buildName('listener-rule'),
      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        listenerArn,
        priority: this.options.loadBalancerOptions.priority,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        actions: [{ type: 'forward', targetGroupArn: this.targetGroup!.arn }],
        conditions: [{ hostHeader: { values: [this.options.defaultAlias] } }],
        tags: this.options.tags,
      },
      this.defaultResourceOptions,
    );
  }

  createAutoScalingAttachment(): autoscaling.Attachment | undefined {
    if (!this.options.loadBalancerOptions) {
      return undefined;
    }

    return new autoscaling.Attachment(
      this.buildName('asg-attachment'),
      {
        autoscalingGroupName: this.autoScalingGroup.then((asg) => {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          log.info(asg.id);
          return asg.id;
        }),
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        lbTargetGroupArn: this.targetGroup!.arn,
      },
      this.defaultResourceOptions,
    );
  }

  createAppAutoScalingPolicy(
    name: string,
    metricName: string,
    action: string,
    stepAdjustment: inputs.appautoscaling.PolicyStepScalingPolicyConfigurationStepAdjustment,
  ): appautoscaling.Policy {
    return new appautoscaling.Policy(
      name,
      {
        policyType: 'StepScaling',
        name: [this.options.name, metricName, action].join('-'),
        resourceId: this.appAutoScalingTarget.resourceId,
        scalableDimension: this.appAutoScalingTarget.scalableDimension,
        serviceNamespace: this.appAutoScalingTarget.serviceNamespace,
        stepScalingPolicyConfiguration: {
          adjustmentType: 'ChangeInCapacity',
          cooldown: 60,
          metricAggregationType: 'Average',
          stepAdjustments: [stepAdjustment],
        },
      },
      this.defaultResourceOptions,
    );
  }

  createCloudWatchMetricAlarm(
    name: string,
    metricName: string,
    action: string,
    actionArn: Input<string>,
    comparisonOperator: string,
    period: number,
    statistic: string,
    threshold: number,
  ): cloudwatch.MetricAlarm {
    const alarmName = [this.options.name, metricName, action].join('-');
    const alarmDescription = `Scale ${action} alarm for ${this.options.name.toString()} due to ${metricName}`;

    return new cloudwatch.MetricAlarm(
      name,
      {
        alarmDescription,
        namespace: 'AWS/ECS',
        name: alarmName,
        alarmActions: [actionArn],
        comparisonOperator,
        threshold,
        evaluationPeriods: 1,
        metricName,
        period,
        statistic,
        datapointsToAlarm: 1,
        dimensions: {
          ServiceName: this.options.name,
          ClusterName: this.options.clusterName,
        },
        tags: this.options.tags,
      },
      this.defaultResourceOptions,
    );
  }

  createTurnOnAndOffSchedule(): void {
    const defaultValues: EcsEc2TurnOnAndOffScheduleOptions = {
      disable: false,
      offSchedule: {
        schedule: 'cron(30 7 * * ? *)',
        maxCapacity: 0,
        minCapacity: 0,
      },
      onSchedule: {
        schedule: 'cron(0 14 * * ? *)',
        maxCapacity: 2,
        minCapacity: 1,
      },
    };
    const { disable, offSchedule, onSchedule } = this.options.turnOnAndOffSchedule || defaultValues;
    if (!disable) {
      new appautoscaling.ScheduledAction(
        this.buildName('scheduled-action-on'),
        {
          name: `${this.options.name.toString()}-on-schedule`,
          resourceId: this.appAutoScalingTarget.resourceId,
          scalableDimension: this.appAutoScalingTarget.scalableDimension,
          serviceNamespace: this.appAutoScalingTarget.serviceNamespace,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          schedule: onSchedule?.schedule ?? defaultValues.onSchedule!.schedule,
          scalableTargetAction: {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            minCapacity: onSchedule?.minCapacity ?? defaultValues.onSchedule!.minCapacity,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            maxCapacity: onSchedule?.maxCapacity ?? defaultValues.onSchedule!.maxCapacity,
          },
        },
        this.defaultResourceOptions,
      );
      new appautoscaling.ScheduledAction(
        this.buildName('scheduled-action-off'),
        {
          name: `${this.options.name.toString()}-off-schedule`,
          resourceId: this.appAutoScalingTarget.resourceId,
          scalableDimension: this.appAutoScalingTarget.scalableDimension,
          serviceNamespace: this.appAutoScalingTarget.serviceNamespace,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          schedule: offSchedule?.schedule ?? defaultValues.offSchedule!.schedule,
          scalableTargetAction: {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            minCapacity: offSchedule?.minCapacity ?? defaultValues.offSchedule!.minCapacity,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            maxCapacity: offSchedule?.maxCapacity ?? defaultValues.offSchedule!.maxCapacity,
          },
        },
        this.defaultResourceOptions,
      );
    }
  }
}
