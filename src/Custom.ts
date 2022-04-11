import { ComponentResource, ComponentResourceOptions, Input, ResourceOptions } from '@pulumi/pulumi';

export interface CustomComponentResourceOptions {
  tags?: Record<string, Input<string>>;
}

/**
 * Coding standards:
 * 1. getXX will return an object or return a getXX from pulumi
 * 2. build will return a string or objects used in getXX
 * 3. createXX will return a new instance of an object
 */
export abstract class CustomComponentResource extends ComponentResource {
  protected readonly defaultResourceOptions: ResourceOptions;
  constructor(
    type: string,
    protected readonly name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args?: Record<string, Input<any>>,
    opts?: ComponentResourceOptions,
    remote?: boolean,
  ) {
    super(`rzdevelop:components:${type}`, name, args, opts, remote);
    this.defaultResourceOptions = { parent: this };
  }

  protected buildName(name: string): string {
    return `${this.name}-${name}`;
  }
}
