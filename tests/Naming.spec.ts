import 'mocha';

import * as assert from 'assert';

import * as pulumi from '@pulumi/pulumi';

import { Naming } from '../src';

pulumi.runtime.setMocks({
  newResource: function (args: pulumi.runtime.MockResourceArgs): { id: string; state: any } {
    return {
      id: args.inputs.name + '_id',
      state: args.inputs,
    };
  },
  call: function (args: pulumi.runtime.MockCallArgs) {
    return args.inputs;
  },
});

describe('Naming', function () {
  let testSubject: Naming;
  const appName = 'my-app';
  const envName = 'development';
  const purpose = 'api';

  before(async function () {
    testSubject = new Naming('test-Naming', { appName, envName, purpose });
  });

  describe('when creating Naming component', () => {
    it('should have a fullName', (done) => {
      pulumi.all([testSubject.urn, testSubject.fullName]).apply(([urn, fullName]) => {
        try {
          assert.strictEqual(fullName, `${envName}-${appName}-${purpose}`);
        } catch (error) {
          error.message = `Error in ${urn}`;
          return done(error);
        }

        done();
      });
    });

    describe('when setting defaultTags', () => {
      const mockDefaultTags = {
        Name: `${envName}-${appName}-${purpose}`,
        Environment: envName,
        Application: appName,
        Description: `Resource made with Pulumi for ${envName}-${appName}-${purpose}`,
        Pulumi: 'true',
      };
      describe('when purpose is provided', () => {
        it('should have complete defaultTags', (done) => {
          pulumi.all([testSubject.urn, testSubject.defaultTags]).apply(([urn, defaultTags]) => {
            try {
              assert.deepStrictEqual(defaultTags, {
                ...mockDefaultTags,
                Purpose: purpose,
              });
              done();
            } catch (error) {
              error.message = `Error in ${urn}`;
              return done(error);
            }
          });
        });
      });

      describe('when purpose is NOT provided', () => {
        before(async function () {
          testSubject = new Naming('test-Naming', { appName, envName });
        });

        it('should not have Purpose in defaultTags', (done) => {
          pulumi.all([testSubject.urn, testSubject.defaultTags]).apply(([urn, defaultTags]) => {
            try {
              assert.deepStrictEqual(defaultTags, {
                ...mockDefaultTags,
                Name: `${envName}-${appName}`,
                Description: `Resource made with Pulumi for ${envName}-${appName}`,
              });
              done();
            } catch (error) {
              error.message = `Error in ${urn}`;
              return done(error);
            }
          });
        });
      });
    });
  });
});
