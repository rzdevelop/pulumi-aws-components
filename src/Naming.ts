import { ComponentResourceOptions, Input } from '@pulumi/pulumi';
import { CustomComponentResource } from './Custom';

export interface NamingOptions {
  envName: string;
  appName: string;
  purpose?: string;
}

export class Naming extends CustomComponentResource {
  fullName: string;
  defaultTags: Record<string, Input<string>>;

  constructor(name: string, options: NamingOptions, opts?: ComponentResourceOptions) {
    super('Naming', name, {}, opts);

    this.fullName = [options.envName, options.appName, options.purpose].filter(Boolean).join('-');
    this.defaultTags = {
      Name: this.fullName,
      Environment: options.envName,
      Application: options.appName,
      Description: `Resource made with Pulumi for ${this.fullName}`,
      Pulumi: 'true',
    };
    if (options.purpose) {
      this.defaultTags['Purpose'] = options.purpose;
    }

    this.registerOutputs({
      fullName: this.fullName,
      defaultTags: this.defaultTags,
    });
  }
}
