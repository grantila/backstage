/*
 * Copyright 2021 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { TemplateActionRegistry } from '../tasks/TemplateConverter';
import { FilePreparer, PreparerBuilder } from './prepare';
import Docker from 'dockerode';
import { TemplaterBuilder, TemplaterValues } from './templater';
import { PublisherBuilder } from './publish';
import { CatalogApi } from '@backstage/catalog-client';
import { getEntityName } from '@backstage/catalog-model';

type Options = {
  dockerClient: Docker;
  preparers: PreparerBuilder;
  templaters: TemplaterBuilder;
  publishers: PublisherBuilder;
  catalogClient: CatalogApi;
};

export function registerLegacyActions(
  registry: TemplateActionRegistry,
  options: Options,
) {
  const {
    dockerClient,
    preparers,
    templaters,
    publishers,
    catalogClient,
  } = options;

  registry.register({
    id: 'legacy:prepare',
    async handler(ctx) {
      ctx.logger.info('Preparing the skeleton');
      const { protocol, url } = ctx.parameters;
      const preparer =
        protocol === 'file' ? new FilePreparer() : preparers.get(url as string);

      await preparer.prepare({
        url: url as string,
        logger: ctx.logger,
        workspacePath: ctx.workspacePath,
      });
    },
  });

  registry.register({
    id: 'legacy:template',
    async handler(ctx) {
      ctx.logger.info('Running the templater');
      const templater = templaters.get(ctx.parameters.templater as string);
      await templater.run({
        workspacePath: ctx.workspacePath,
        dockerClient,
        logStream: ctx.logStream,
        values: ctx.parameters.values as TemplaterValues,
      });
    },
  });

  registry.register({
    id: 'legacy:publish',
    async handler(ctx) {
      const { values } = ctx.parameters;
      if (
        typeof values !== 'object' ||
        values === null ||
        Array.isArray(values)
      ) {
        throw new Error(
          `Invalid values passed to publish, got ${typeof values}`,
        );
      }
      const storePath = values.storePath as unknown;
      if (typeof storePath !== 'string') {
        throw new Error(
          `Invalid store path passed to publish, got ${typeof storePath}`,
        );
      }
      const owner = values.owner as unknown;
      if (typeof owner !== 'string') {
        throw new Error(`Invalid owner passed to publish, got ${typeof owner}`);
      }

      const publisher = publishers.get(storePath);
      ctx.logger.info('Will now store the template');
      const { remoteUrl, catalogInfoUrl } = await publisher.publish({
        values: {
          ...values,
          owner,
          storePath,
        },
        workspacePath: ctx.workspacePath,
        logger: ctx.logger,
      });
      ctx.output('remoteUrl', remoteUrl);
      if (catalogInfoUrl) {
        ctx.output('catalogInfoUrl', catalogInfoUrl);
      }
    },
  });

  registry.register({
    id: 'catalog:register',
    async handler(ctx) {
      const { catalogInfoUrl } = ctx.parameters;
      ctx.logger.info(`Registering ${catalogInfoUrl} in the catalog`);

      const result = await catalogClient.addLocation({
        type: 'url',
        target: catalogInfoUrl as string,
      });
      if (result.entities.length >= 1) {
        const { kind, name, namespace } = getEntityName(result.entities[0]);
        ctx.output('entityRef', `${kind}:${namespace}/${name}`);
      }
    },
  });
}
