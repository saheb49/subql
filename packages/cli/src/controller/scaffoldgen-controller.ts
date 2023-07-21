// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import fs from 'fs';
import path from 'path';
import {EventFragment, FunctionFragment} from '@ethersproject/abi/src.ts/fragments';
import {loadFromJsonOrYaml} from '@subql/common';
import ejs from 'ejs';
import {Interface} from 'ethers/lib/utils';
import * as inquirer from 'inquirer';
import {upperFirst} from 'lodash';
import {parseContractPath} from 'typechain';
import {parseDocument} from 'yaml';
import {SelectedMethod, UserInput} from '../commands/codegen/generate';

const SCAFFOLD_HANDLER_TEMPLATE_PATH = path.resolve(__dirname, '../template/scaffold-handlers.ts.ejs');
const ROOT_MAPPING_DIR = 'src/mappings';
const DEFAULT_HANDLER_BUILD_PATH = './dist/index.js';

interface TopicsFilter {
  topics: string[];
}
interface FunctionFilter {
  function: string;
}
type Filter = TopicsFilter | FunctionFilter;

interface HandlerType {
  handler: string;
  kind: string;
  filter: Filter;
}

interface DatasourceProp {
  kind: string;
  startBlock: number;
  options: {
    abi: string;
    address?: string;
  };
  assets: {
    [key: string]: {
      file: string;
    };
  };
  mapping: {
    file: string;
    handlers: HandlerType[];
  };
}

export async function promptSelectables(
  input: string,
  availableMethods: string[],
  memArr: string[]
): Promise<string[]> {
  if (input === '*') {
    return availableMethods;
  }

  if (input) {
    try {
      const chosenFn = await inquirer.prompt({
        name: 'functions',
        message: 'Select Functions',
        type: 'checkbox',
        choices: availableMethods,
      });
      memArr.push(...chosenFn.functions);
    } catch (e) {
      throw new Error(e);
    }
  }
  return memArr;
}

export async function renderTemplate(templatePath: string, outputPath: string, templateData: ejs.Data): Promise<void> {
  const data = await ejs.renderFile(templatePath, templateData);
  await fs.promises.writeFile(outputPath, data);
}

export function getAbiInterface(projectPath: string, abiPath: string): Interface {
  const abi = loadFromJsonOrYaml(path.join(projectPath, abiPath)) as any;
  return new Interface(abi);
}

export function getAvailableEvents(abiInterface: Interface): {[p: string]: EventFragment} {
  return abiInterface.events;
}

export function filterObjectsByStateMutability(obj: {[p: string]: FunctionFragment}): {[p: string]: FunctionFragment} {
  const filteredObject: {[p: string]: FunctionFragment} = {};
  for (const key in obj) {
    if (obj[key].stateMutability !== 'view') {
      filteredObject[key] = obj[key];
    }
  }
  return filteredObject;
}

export function getAvailableFunctions(abiInterface: Interface): {[p: string]: FunctionFragment} {
  return filterObjectsByStateMutability(abiInterface.functions);
}

function constructDatasources(userInput: UserInput): DatasourceProp {
  const abiName = parseContractPath(userInput.abiPath).name;
  const formattedHandlers: HandlerType[] = [];

  userInput.functions.map((fn) => {
    const handler: HandlerType = {
      handler: `handle${upperFirst(fn.name)}_${abiName}Tx`,
      kind: 'ethereum/TransactionHandler',
      filter: {
        function: fn.method,
      },
    };
    formattedHandlers.push(handler);
  });

  userInput.events.map((event) => {
    const handler: HandlerType = {
      handler: `handle${upperFirst(event.name)}_${abiName}Log`,
      kind: 'ethereum/LogHandler',
      filter: {
        topics: [event.method],
      },
    };
    formattedHandlers.push(handler);
  });

  return {
    kind: 'ethereum/Runtime',
    startBlock: userInput.startBlock,
    options: {
      abi: abiName,
      address: userInput.address,
    },
    assets: {
      [abiName]: {
        file: userInput.abiPath,
      },
    },
    mapping: {
      file: DEFAULT_HANDLER_BUILD_PATH,
      handlers: formattedHandlers,
    },
  };
}

export async function generateManifest(projectPath: string, manifestPath: string, userInput: UserInput): Promise<void> {
  try {
    const existingManifest = (await fs.promises.readFile(path.join(projectPath, manifestPath), 'utf8')) as any;
    const existingManifestData = parseDocument(existingManifest);
    const clonedExistingManifestData = existingManifestData.clone();

    const existingDatasource = existingManifestData.get('dataSources') as any;

    // Should be for every ABI

    const newDataSourcesData = existingDatasource.toJSON().concat(...[constructDatasources(userInput)]);
    clonedExistingManifestData.set('dataSources', newDataSourcesData);

    // load yaml
    await fs.promises.writeFile(path.join(projectPath, manifestPath), clonedExistingManifestData.toString(), 'utf8');
  } catch (e) {
    throw new Error(e);
  }
}

export interface handlerPropType {
  name: string;
  argName: string;
  argType: string;
}

export interface abiPropType {
  name: string;
  handlers: handlerPropType[];
}

export function constructHandlerProps(methods: [SelectedMethod[], SelectedMethod[]], abiName: string): abiPropType {
  const handlers: handlerPropType[] = [];
  const [events, functions] = methods;

  functions.map((fn) => {
    const fnProp: handlerPropType = {
      name: `handle${upperFirst(fn.name)}`,
      argName: 'tx',
      argType: `${upperFirst(fn.name)}Transaction`,
    };
    handlers.push(fnProp);
  });

  events.map((event) => {
    const fnProp: handlerPropType = {
      name: `handle${upperFirst(event.name)}`,
      argName: 'log',
      argType: `${upperFirst(event.name)}Log`,
    };
    handlers.push(fnProp);
  });

  return {
    name: abiName,
    handlers: handlers,
  };
}

export async function generateHandlers(
  selectedMethods: [SelectedMethod[], SelectedMethod[]],
  projectPath: string,
  abiPath: string
): Promise<void> {
  const abiProps = constructHandlerProps(selectedMethods, parseContractPath(abiPath).name);

  try {
    await renderTemplate(
      SCAFFOLD_HANDLER_TEMPLATE_PATH,
      path.join(projectPath, ROOT_MAPPING_DIR, 'mappingHandlers.ts'),
      {
        props: {
          abis: [abiProps],
        },
        helper: {upperFirst},
      }
    );
  } catch (e) {
    console.error(`unable to generate scaffold. ${e.message}`);
  }

  await fs.promises.writeFile(path.join(projectPath, 'src/index.ts'), 'export * from "./mappings/mappingHandlers"');
}