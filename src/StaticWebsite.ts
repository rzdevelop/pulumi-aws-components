import { ComponentResourceOptions, Input, Output } from '@pulumi/pulumi';
import { route53, acm } from '@pulumi/aws';
import { CustomComponentResource } from './Custom';
import { Bucket } from './Bucket';
import { Cloudfront } from './Cloudfront';

export interface StaticWebsiteDomainOptions {
  domain: string;
  preventAddingWildcard?: boolean;
}

export interface StaticWebsiteRoute53Options {
  zoneId: Output<string>;
}

export interface StaticWebsiteOptions {
  name: Input<string>;
  aliases?: string[];
  domainOptions?: StaticWebsiteDomainOptions;
  route53Options?: StaticWebsiteRoute53Options;
  tags?: Record<string, Input<string>>;
}

export class StaticWebsite extends CustomComponentResource {
  storage: Bucket;
  cdn: Cloudfront;

  constructor(name: string, private readonly options: StaticWebsiteOptions, opts?: ComponentResourceOptions) {
    super('StaticWebsite', name, {}, opts);

    let certificateArn: Promise<string> | undefined = undefined;

    if (this.options.domainOptions) {
      const domain = [!this.options.domainOptions.preventAddingWildcard && '*', this.options.domainOptions.domain]
        .filter(Boolean)
        .join('.');
      const acmCertificate = acm.getCertificate({ domain });
      certificateArn = acmCertificate.then((certificate) => certificate.arn);
    }

    this.storage = new Bucket(
      this.buildName('storage'),
      { bucketName: this.options.name, createOriginAccessIdentity: true, tags: options.tags },
      this.defaultResourceOptions,
    );

    this.cdn = new Cloudfront(
      this.buildName('cdn'),
      {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        originAccessIdentityPath: this.storage.oai!.cloudfrontAccessIdentityPath,
        originId: 's3Origin',
        regionalDomainName: this.storage.bucket.bucketRegionalDomainName,
        aliases: this.options.aliases,
        certificateArn,
        tags: options.tags,
      },
      this.defaultResourceOptions,
    );

    if (this.options.route53Options && this.options.aliases) {
      const zone = this.options.route53Options.zoneId.apply((zoneId) =>
        route53.getZone({
          zoneId,
        }),
      );
      const zoneId = zone.apply((zone) => zone.zoneId);

      this.options.aliases.map(
        (alias, idx) =>
          new route53.Record(
            this.buildName(`record-${idx}`),
            {
              name: alias,
              type: 'CNAME',
              ttl: 5,
              records: [this.cdn.distribution.domainName],
              zoneId,
            },
            this.defaultResourceOptions,
          ),
      );
    }
  }
}
