import { ComponentResource, ComponentResourceOptions, Input, ResourceOptions } from '@pulumi/pulumi';

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
