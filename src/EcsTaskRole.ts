import { ComponentResourceOptions, Input } from '@pulumi/pulumi';
import { iam } from '@pulumi/aws';
import { CustomComponentResource, CustomComponentResourceOptions } from './Custom';

export interface EcsTaskRoleOptions extends CustomComponentResourceOptions {
  name: Input<string>;
}

export class EcsTaskRole extends CustomComponentResource {
  readonly role: iam.Role;

  constructor(name: string, private readonly options: EcsTaskRoleOptions, opts?: ComponentResourceOptions) {
    super('EcsTaskRole', name, {}, opts);

    this.role = new iam.Role(
      this.buildName('role'),
      {
        name: `${this.options.name.toString()}-task-role`,
        assumeRolePolicy: this.getTrustPolicyDocument().then((policyDocument) => policyDocument.json),
      },
      this.defaultResourceOptions,
    );

    this.registerOutputs();
  }

  getTrustPolicyDocument(): Promise<iam.GetPolicyDocumentResult> {
    return iam.getPolicyDocument({
      version: '2012-10-17',
      statements: [
        {
          sid: 'ECSTrustPolicy',
          effect: 'Allow',
          actions: ['sts:AssumeRole'],
          notActions: [],
          notResources: [],
          resources: [],
          principals: [{ type: 'Service', identifiers: ['ecs-tasks.amazonaws.com'] }],
        },
      ],
    });
  }
}
