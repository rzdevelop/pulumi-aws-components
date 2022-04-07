import { ComponentResourceOptions, Input } from '@pulumi/pulumi';
import { cloudfront } from '@pulumi/aws';
import { input as inputs } from '@pulumi/aws/types';
import { CustomComponentResource } from './Custom';

export interface CloudfrontOptions {
  aliases?: Input<string[]>;
  originId: Input<string>;
  regionalDomainName: Input<string>;
  originAccessIdentityPath: Input<string>;
  certificateArn?: Input<string>;
  origins?: Input<inputs.cloudfront.DistributionOrigin>[];
  orderedCacheBehaviors?: Input<Input<inputs.cloudfront.DistributionOrderedCacheBehavior>[]>;
  tags?: Record<string, Input<string>>;
}

export class Cloudfront extends CustomComponentResource {
  readonly distribution: cloudfront.Distribution;
  constructor(name: string, private readonly options: CloudfrontOptions, opts?: ComponentResourceOptions) {
    super('Cloudfront', name, {}, opts);
    const aliases = options.aliases || [];
    const origins = [
      this.getS3Origin(options.regionalDomainName, options.originId, options.originAccessIdentityPath),
      ...(options.origins ? options.origins : []),
    ];
    const customErrorResponses = this.getErrorResponses();
    const viewerCertificate = this.getViewerCertificate();
    const restrictions = this.getRestrictions();
    const defaultCacheBehavior = this.getDefaultCacheBehavior();

    this.distribution = new cloudfront.Distribution(
      this.buildName('distribution'),
      {
        enabled: true,
        isIpv6Enabled: true,
        waitForDeployment: true,
        defaultRootObject: 'index.html',
        orderedCacheBehaviors: options.orderedCacheBehaviors,
        aliases,
        origins,
        restrictions,
        viewerCertificate,
        defaultCacheBehavior,
        customErrorResponses,
        tags: options.tags,
      },
      this.defaultResourceOptions,
    );

    this.registerOutputs();
  }

  private getS3Origin(
    regionalDomainName: Input<string>,
    originId: Input<string>,
    originAccessIdentityPath: Input<string>,
  ): inputs.cloudfront.DistributionOrigin {
    return {
      domainName: regionalDomainName,
      originId,
      s3OriginConfig: {
        originAccessIdentity: originAccessIdentityPath,
      },
    };
  }

  private getErrorResponses(errorCodes = [400, 403, 404, 500]): inputs.cloudfront.DistributionCustomErrorResponse[] {
    return errorCodes.map((errorCode) => ({
      errorCode,
      errorCachingMinTtl: 300,
      responseCode: 200,
      responsePagePath: '/index.html',
    }));
  }

  private getViewerCertificate(): inputs.cloudfront.DistributionViewerCertificate {
    if (this.options.certificateArn) {
      return {
        acmCertificateArn: this.options.certificateArn,
        cloudfrontDefaultCertificate: false,
        sslSupportMethod: 'sni-only',
        minimumProtocolVersion: 'TLSv1.2_2021',
      };
    }
    return {
      cloudfrontDefaultCertificate: true,
    };
  }

  private getRestrictions(): inputs.cloudfront.DistributionRestrictions {
    return {
      geoRestriction: {
        restrictionType: 'none',
      },
    };
  }

  private getDefaultCacheBehavior(): inputs.cloudfront.DistributionDefaultCacheBehavior {
    return {
      targetOriginId: this.options.originId,
      viewerProtocolPolicy: 'redirect-to-https',
      allowedMethods: ['GET', 'HEAD'],
      cachedMethods: ['GET', 'HEAD'],
      forwardedValues: {
        queryString: false,
        cookies: {
          forward: 'none',
        },
      },
      minTtl: 0,
      maxTtl: 0,
      defaultTtl: 0,
      compress: true,
    };
  }
}
