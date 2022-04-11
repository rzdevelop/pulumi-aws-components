import { ComponentResourceOptions, Input } from '@pulumi/pulumi';
import { cloudwatch } from '@pulumi/aws';
import { CustomComponentResource, CustomComponentResourceOptions } from './Custom';

export type CloudWatchRetentionInDaysOptions =
  | 1
  | 3
  | 5
  | 7
  | 14
  | 30
  | 60
  | 90
  | 120
  | 150
  | 180
  | 365
  | 400
  | 545
  | 731
  | 1827
  | 3653
  | 0;

export interface CloudwatchOptions extends CustomComponentResourceOptions {
  name: Input<string>;
  retentionInDays?: Input<CloudWatchRetentionInDaysOptions>;
}

export class CloudWatch extends CustomComponentResource {
  readonly logGroup: cloudwatch.LogGroup;

  constructor(name: string, private readonly options: CloudwatchOptions, opts?: ComponentResourceOptions) {
    super('CloudWatch', name, {}, opts);

    this.logGroup = new cloudwatch.LogGroup(
      this.buildName('log-group'),
      {
        name: this.options.name,
        retentionInDays: this.options.retentionInDays,
        tags: this.options.tags,
      },
      this.defaultResourceOptions,
    );

    this.registerOutputs();
  }
}
