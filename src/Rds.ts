import { ComponentResourceOptions, Input } from '@pulumi/pulumi';
import { rds } from '@pulumi/aws';
import { CustomComponentResource, CustomComponentResourceOptions } from './Custom';

export interface RdsOptions extends CustomComponentResourceOptions {
  name: Input<string>;
  instanceClass?: Input<string>;
  engine?: Input<string>;
  identifier: Input<string>;
  username: Input<string>;
  password: Input<string>;
  storageType?: Input<string>;
  vpcSecurityGroupIds: Input<Input<string>[]>;
  allocatedStorage?: Input<number>;
  maxAllocatedStorage?: Input<number>;
  engineVersion?: Input<string>;
  parameterGroupName?: Input<string>;
}

export class Rds extends CustomComponentResource {
  readonly instance: rds.Instance;

  constructor(name: string, private readonly options: RdsOptions, opts?: ComponentResourceOptions) {
    super('Rds', name, {}, opts);

    this.instance = new rds.Instance(
      this.buildName('instance'),
      {
        engine: this.options.engine || 'postgres',
        parameterGroupName: this.options.parameterGroupName || 'default.postgres12',
        engineVersion: this.options.engineVersion || '12.7',
        identifier: this.options.identifier,
        username: this.options.username,
        password: this.options.password,
        instanceClass: this.options.instanceClass || 'db.t2.micro',
        storageType: this.options.storageType || 'gp2',
        allocatedStorage: this.options.allocatedStorage || 20,
        maxAllocatedStorage: this.options.maxAllocatedStorage || 21,
        vpcSecurityGroupIds: this.options.vpcSecurityGroupIds,
        dbName: this.options.name,
        multiAz: false,
        publiclyAccessible: true,
        backupRetentionPeriod: 0,
        skipFinalSnapshot: true,
        finalSnapshotIdentifier: `${this.options.identifier.toString()}-final-snapshot`,
        tags: this.options.tags,
      },
      this.defaultResourceOptions,
    );

    this.registerOutputs();
  }
}
