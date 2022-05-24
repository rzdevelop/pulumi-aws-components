import { ComponentResourceOptions, Input } from '@pulumi/pulumi';
import { CustomComponentResource, CustomComponentResourceOptions } from './Custom';
import { SecurityGroup } from './SecurityGroup';
import { Rds } from './Rds';

export interface RdsDatabaseOptions extends CustomComponentResourceOptions {
  name: Input<string>;
  dbName: Input<string>;
  username: Input<string>;
  password: Input<string>;
  engineVersion?: Input<string>;
}

export class RdsDatabase extends CustomComponentResource {
  securityGroup: SecurityGroup;
  rds: Rds;

  constructor(name: string, private readonly options: RdsDatabaseOptions, opts?: ComponentResourceOptions) {
    super('RdsDatabase', name, {}, opts);

    this.securityGroup = new SecurityGroup(
      this.buildName('db-sg'),
      {
        name: this.options.name,
        description: `Security Group for ${this.options.name.toString()}`,
        ingress: {
          fromPort: 5432,
          toPort: 5432,
          protocol: 'tcp',
        },
        egress: {
          fromPort: 0,
          toPort: 0,
          protocol: '-1',
        },
        tags: this.options.tags,
      },
      this.defaultResourceOptions,
    );

    this.rds = new Rds(
      this.buildName('rds'),
      {
        vpcSecurityGroupIds: [this.securityGroup.securityGroup.id],
        identifier: this.options.name,
        dbName: this.options.dbName,
        username: this.options.username,
        password: this.options.password,
        engineVersion: this.options.engineVersion || '12.7',
        tags: this.options.tags,
      },
      this.defaultResourceOptions,
    );

    this.registerOutputs();
  }
}
