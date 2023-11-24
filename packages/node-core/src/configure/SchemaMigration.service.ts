// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {
  GraphQLSchema,
  ObjectTypeDefinitionNode,
  parse,
  printSchema,
  visit,
  NameNode,
  DefinitionNode,
  TypeNode,
} from 'graphql';
import {getLogger} from '../logger';

export interface EntityChanges {
  addedFields: NameNode[];
  removedFields: NameNode[];
  modifiedFields: Record<
    string,
    {
      type: {from: string; to: string};
      kind: {from: string; to: string};
    }
  >; // i think from and to can be enums
}

export interface SchemaChanges {
  addedEntities: string[];
  removedEntities: string[];
  modifiedEntities: Record<string, EntityChanges>;
}

// export interface ISchemaMigrationService {
//     schemaComparator(currentSchema: GraphQLSchema, nextSchema: GraphQLSchema):
// }

const logger = getLogger('SchemaMigrationService');
// need test for this
export function extractTypeDetails(typeNode: TypeNode): {type: string; kind: string} {
  let currentTypeNode: TypeNode = typeNode;

  while (currentTypeNode.kind === 'NonNullType' || currentTypeNode.kind === 'ListType') {
    currentTypeNode = currentTypeNode.type;
  }

  const name = currentTypeNode.kind === 'NamedType' ? currentTypeNode.name.value : '';

  return {type: currentTypeNode.kind, kind: name};
}

export class SchemaMigrationService {
  private readonly _currentSchema: GraphQLSchema;
  private readonly _nextSchema: GraphQLSchema;
  constructor(currentSchema: GraphQLSchema, nextSchema: GraphQLSchema) {
    this._currentSchema = currentSchema;
    this._nextSchema = nextSchema;
  }
  compareSchema(): SchemaChanges {
    const currentSchemaString = printSchema(this._currentSchema);
    const nextSchemaString = printSchema(this._nextSchema);

    // Parse the schema strings into AST
    const currentSchemaAST = parse(currentSchemaString);
    const nextSchemaAST = parse(nextSchemaString);

    const changes: SchemaChanges = {
      addedEntities: [],
      removedEntities: [],
      modifiedEntities: {},
    };

    visit(nextSchemaAST, {
      ObjectTypeDefinition(node) {
        const typeName = node.name.value;
        const oldTypeNode = currentSchemaAST.definitions.find(
          (def: any) => def.kind === 'ObjectTypeDefinition' && def.name.value === typeName
        ) as ObjectTypeDefinitionNode;

        if (oldTypeNode === undefined) {
          changes.addedEntities.push(typeName);
        } else {
          const newFields = node.fields?.map((field) => field) || [];
          const oldFields = oldTypeNode.fields?.map((field) => field) || [];

          const addedFields = newFields.filter(
            (field) => !oldFields.some((oldField) => oldField.name.value === field.name.value)
          );
          const removedFields = oldFields.filter(
            (field) => !newFields.some((newField) => newField.name.value === field.name.value)
          );
          // check for modified fields
          const modifiedFields = newFields.reduce(
            (acc, newField) => {
              const oldField = oldFields.find((oldField) => oldField.name.value === newField.name.value);

              const newFieldDetails = extractTypeDetails(newField.type);
              const oldFieldDetails = oldField ? extractTypeDetails(oldField.type) : null;
              if (
                oldFieldDetails &&
                newFieldDetails &&
                (oldFieldDetails.kind !== newFieldDetails.kind || oldFieldDetails.kind !== newFieldDetails.kind)
              ) {
                acc[newField.name.value] = {
                  type: {from: oldFieldDetails.type, to: newFieldDetails.type},
                  kind: {from: oldFieldDetails.kind, to: newFieldDetails.kind},
                };
              }
              return acc;
            },
            {} as Record<
              string,
              {
                type: {from: string; to: string};
                kind: {from: string; to: string};
              }
            >
          );

          if (addedFields.length || removedFields.length || Object.keys(modifiedFields).length > 0) {
            changes.modifiedEntities[typeName] = {
              addedFields: addedFields.map((f) => f.name),
              removedFields: removedFields.map((f) => f.name),
              modifiedFields,
            };
          }
        }
      },
    });

    // Detecting types removed in the new schema
    visit(currentSchemaAST, {
      ObjectTypeDefinition(node) {
        const typeName = node.name.value;
        const typeExistsInNew = nextSchemaAST.definitions.some(
          (def: DefinitionNode) => def.kind === 'ObjectTypeDefinition' && def.name.value === typeName
        );

        if (!typeExistsInNew) {
          changes.removedEntities.push(typeName);
        }
      },
    });
    return changes;
  }
  // Operations, everything has to happen in a transaction
  //
  addColumn() {
    //
  }

  removeColumn() {
    //
  }

  createTable() {
    //
  }
  dropTable() {
    //
  }
  createIndex() {
    //
  }
}