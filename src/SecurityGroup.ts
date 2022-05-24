import { ComponentResourceOptions, Input } from '@pulumi/pulumi';
import { ec2 } from '@pulumi/aws';
import { CustomComponentResource, CustomComponentResourceOptions } from './Custom';

export interface SecurityGroupOptions extends CustomComponentResourceOptions {
  name: Input<string>;
  description?: Input<string>;
  vpcId?: Input<string>;
  ingress: {
    fromPort: Input<number>;
    toPort: Input<number>;
    protocol: Input<string>;
    cidrBlocks?: Input<Input<string>[]>;
  };
  egress: {
    fromPort: Input<number>;
    toPort: Input<number>;
    protocol: Input<string>;
    cidrBlocks?: Input<Input<string>[]>;
  };
}

export class SecurityGroup extends CustomComponentResource {
  readonly securityGroup: ec2.SecurityGroup;
  readonly securityGroupIngressRule: ec2.SecurityGroupRule;
  readonly securityGroupEgressRule: ec2.SecurityGroupRule;

  constructor(name: string, private readonly options: SecurityGroupOptions, opts?: ComponentResourceOptions) {
    super('SecurityGroup', name, {}, opts);

    this.securityGroup = new ec2.SecurityGroup(
      this.buildName('security-group'),
      {
        name: this.options.name,
        description: this.options.description || `${this.options.name.toString()} SecurityGroup`,
        vpcId: this.options.vpcId,
        tags: this.options.tags,
      },
      this.defaultResourceOptions,
    );

    this.securityGroupIngressRule = new ec2.SecurityGroupRule(
      this.buildName('ingress'),
      {
        type: 'ingress',
        securityGroupId: this.securityGroup.id,
        fromPort: this.options.ingress.fromPort,
        toPort: this.options.ingress.toPort,
        protocol: this.options.ingress.protocol,
        cidrBlocks: this.options.ingress.cidrBlocks || ['0.0.0.0/0'],
      },
      this.defaultResourceOptions,
    );

    this.securityGroupEgressRule = new ec2.SecurityGroupRule(
      this.buildName('egress'),
      {
        type: 'egress',
        securityGroupId: this.securityGroup.id,
        fromPort: this.options.egress.fromPort,
        toPort: this.options.egress.toPort,
        protocol: this.options.egress.protocol,
        cidrBlocks: this.options.egress.cidrBlocks || ['0.0.0.0/0'],
      },
      this.defaultResourceOptions,
    );

    this.registerOutputs();
  }
}
