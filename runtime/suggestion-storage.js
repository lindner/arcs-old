/**
 * @license
 * Copyright (c) 2018 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */
import {assert} from '../platform/assert-web.js';
import {Manifest} from './manifest.js';
import {RecipeResolver} from './recipe/recipe-resolver.js';
import {Schema} from './ts-build/schema.js';
import {Type} from './ts-build/type.js';

export class SuggestionStorage {
  constructor(arc, userid) {
    assert(arc, `Arc must not be null`);
    assert(arc._storageKey, `Arc must has a storage key`);
    assert(userid, `User id must not be null`);

    this._arc = arc;
    let storageKeyTokens = this._arc._storageKey.split('/');
    this._arcKey = storageKeyTokens.slice(-1)[0];
    this._storageKey = 
      `${storageKeyTokens.slice(0, -2).join('/')}/users/${userid}/suggestions/${this._arcKey}`;

    this._recipeResolver = new RecipeResolver(this._arc);
    this._suggestionsUpdatedCallbacks = [];

    let suggestionsSchema = new Schema({
      names: ['Suggestions'],
      fields: {current: 'Object'}
    });
    this._storePromise = this._arc._storageProviderFactory._storageForKey(this.storageKey)._join(
        `${this.userid}-suggestions`,
        Type.newEntity(suggestionsSchema),
        this._storageKey,
        /* shoudExist= */ 'unknown',
        /* referenceMode= */ false);
    this._storePromise.then((store) => {
        this._store = store;
        this._store.on('change', () => this._onStoreUpdated(), this);
      },
      (e) => console.error(`Failed to initialize suggestion store at '${this._storageKey}' with error: ${e}`));
  }

  get storageKey() { return this._storageKey; }
  get store() { return this._store; }

  async ensureInitialized() {
    await this._storePromise;
    assert(this._store, `Store couldn't be initialized`);
  }

  async _onStoreUpdated() {
    let value = (await this._store.get()) || {};
    if (!value.current) {
      return;
    }

    let plans = [];
    for (let {descriptionText, recipe, hash, rank, suggestionContent} of value.current.plans) {
      plans.push({
        plan: await this._planFromString(recipe),
        descriptionText,
        recipe,
        hash,
        rank,
        suggestionContent
      });
    }
    console.log(`Suggestions store was updated, ${plans.length} suggestions fetched.`);
    this._suggestionsUpdatedCallbacks.forEach(callback => callback({plans}));
  }

  registerSuggestionsUpdatedCallback(callback) {
    this._suggestionsUpdatedCallbacks.push(callback);
  }

  async _planFromString(planString) {
    let manifest = await Manifest.parse(
        planString, {loader: this._arc.loader, context: this._arc._context, fileName: ''});
    assert(manifest._recipes.length == 1);
    let plan = manifest._recipes[0];
    assert(plan.normalize(), `can't normalize deserialized suggestion`);
    if (!plan.isResolved()) {
      let resolvedPlan = await this._recipeResolver.resolve(plan);
      assert(resolvedPlan, `can't resolve plan: ${plan.toString({showUnresolved: true})}`);
      if (resolvedPlan) {
        plan = resolvedPlan;
      }
    }
    return plan;
  }
}