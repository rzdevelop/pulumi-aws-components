import { ComponentResourceOptions, Input, Output, all } from '@pulumi/pulumi';
import { s3, cloudfront, iam } from '@pulumi/aws';
import { input as inputs } from '@pulumi/aws/types';
import { CustomComponentResource } from './Custom';

export interface BucketOptions {
  bucketName: Input<string>;
  disableServerSideEncryption?: Input<boolean>;
  disableSslRequestsOnly?: Input<boolean>;
  createOriginAccessIdentity?: Input<boolean>;
  disablePublicAccessBlock?: Input<boolean>;
  tags?: Record<string, Input<string>>;
}

export class Bucket extends CustomComponentResource {
  readonly bucket: s3.Bucket;
  readonly oai?: cloudfront.OriginAccessIdentity;
  readonly bucketPolicy: s3.BucketPolicy;

  constructor(name: string, private readonly options: BucketOptions, opts?: ComponentResourceOptions) {
    super('Bucket', name, {}, opts);

    if (options.createOriginAccessIdentity) {
      this.oai = this.createOriginAccessIdentityPath();
    }

    let serverSideEncryptionConfiguration: inputs.s3.BucketServerSideEncryptionConfiguration | undefined = undefined;

    if (!options.disableServerSideEncryption) {
      serverSideEncryptionConfiguration = this.getServerSideEncryptionConfiguration();
    }

    this.bucket = new s3.Bucket(
      this.buildName('bucket'),
      {
        bucket: options.bucketName,
        forceDestroy: true,
        serverSideEncryptionConfiguration,
        tags: options.tags,
      },
      this.defaultResourceOptions,
    );
    this.bucketPolicy = this.createBucketPolicy();

    if (!options.disablePublicAccessBlock) {
      this.createPublicAccessBlock();
    }
  }

  private createOriginAccessIdentityPath(): cloudfront.OriginAccessIdentity {
    return new cloudfront.OriginAccessIdentity(
      this.buildName('oai'),
      {
        comment: this.options.bucketName,
      },
      this.defaultResourceOptions,
    );
  }

  private getServerSideEncryptionConfiguration(): inputs.s3.BucketServerSideEncryptionConfiguration {
    return {
      rule: {
        applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' },
      },
    };
  }

  private createBucketPolicy(): s3.BucketPolicy {
    return new s3.BucketPolicy(
      this.buildName('bucket-policy'),
      {
        bucket: this.bucket.id,
        policy: this.getPolicyDocument().apply((policyDocument) => policyDocument.json),
      },
      this.defaultResourceOptions,
    );
  }

  private buildOaiPolicyStatement(): Output<inputs.iam.GetPolicyDocumentStatement> | undefined {
    if (!this.options.createOriginAccessIdentity) {
      return undefined;
    }
    return this.bucket.arn.apply((bucketArn) =>
      this.oai!.iamArn.apply((iamArn) => ({
        sid: 'CloudfrontOriginAccessIdentity',
        actions: ['s3:GetObject'],
        resources: [`${bucketArn}/*`],
        principals: [
          {
            type: 'AWS',
            identifiers: [iamArn],
          },
        ],
      })),
    );
  }

  private buildSslRequestsOnlyPolicyStatement(): Output<inputs.iam.GetPolicyDocumentStatement> | undefined {
    if (this.options.disableSslRequestsOnly) {
      return undefined;
    }

    return this.bucket.arn.apply((bucketArn) => ({
      sid: 'AllowSSLRequestsOnly',
      effect: 'Deny',
      actions: ['s3:*'],
      resources: [bucketArn, `${bucketArn}/*`],
      conditions: [
        {
          test: 'Bool',
          variable: 'aws:SecureTransport',
          values: ['false'],
        },
      ],
      principals: [{ type: '*', identifiers: ['*'] }],
    }));
  }

  private getPolicyDocument(): Output<iam.GetPolicyDocumentResult> {
    const statementsOutput: Output<inputs.iam.GetPolicyDocumentStatement>[] = [];

    const oaiPolicyStatement = this.buildOaiPolicyStatement();
    if (oaiPolicyStatement) {
      statementsOutput.push(oaiPolicyStatement);
    }
    const sslRequestsOnlyPolicyStatement = this.buildSslRequestsOnlyPolicyStatement();
    if (sslRequestsOnlyPolicyStatement) {
      statementsOutput.push(sslRequestsOnlyPolicyStatement);
    }

    return all(statementsOutput).apply((statements) =>
      iam.getPolicyDocument({
        statements,
      }),
    );
  }

  private createPublicAccessBlock(): s3.BucketPublicAccessBlock {
    return new s3.BucketPublicAccessBlock(
      this.buildName('public-access-block'),
      {
        bucket: this.bucket.id,
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      this.defaultResourceOptions,
    );
  }
}
