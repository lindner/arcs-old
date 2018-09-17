/**
 * @license
 * Copyright (c) 2017 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import { StorageProviderFactory } from '../ts-build/storage/storage-provider-factory.js';
import { Arc } from '../arc.js';
import { Manifest } from '../manifest.js';
import { Type } from '../ts-build/type.js';
import 'chai/register-expect';
import 'chai/register-assert';

import { PouchDbStorage } from '../ts-build/storage/pouchdb/pouch-db-storage.js';

const testUrl = 'pouchdb://memory/user-test';

// TODO(lindner): run tests for remote and local variants
const testUrlReplicated = 'pouchdb://memory/user-test';

describe('pouchdb', function() {
  this.timeout(10000); // eslint-disable-line no-invalid-this

  let lastStoreId = 0;
  function newStoreKey(name) {
    console.log(`${testUrl}/${name}-${lastStoreId++}`);
    return `${testUrl}/${name}-${lastStoreId++}`;
  }

  // TODO(lindner): switch back to before()?
  beforeEach(async () => {
    // TODO: perhaps we should do this after the test, and use a unique path for each run instead?
    await PouchDbStorage.resetPouchDbStorageForTesting(testUrl);
  });

  let storageInstances = [];

  function createStorage(id) {
    let storage = new StorageProviderFactory(id);
    storageInstances.push(storage);
    return storage;
  }

  after(() => {
    storageInstances.map(s => s.shutdown());
    storageInstances = [];
  });

  describe('variable', () => {
    it('supports basic construct and mutate', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text value
      `);
      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let value = 'Hi there' + Math.random();
      let variable = await storage.construct('test0', BarType, newStoreKey('variable'));
      await variable.set({ id: 'test0:test', value });
      let result = await variable.get();
      expect(result.value).to.equal(value);
    });

    it('resolves concurrent set', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text value
      `);
      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let key = newStoreKey('variable');
      let var1 = await storage.construct('test0', BarType, key);
      assert.isNotNull(var1);
      let var2 = await storage.connect(
        'test0',
        BarType,
        key
      );
      assert.isNotNull(var2);

      await var1.set({ id: 'id1', value: 'value1' });
      await var2.set({ id: 'id2', value: 'value2' });
      const v1 = await var1.get();
      console.log('V1', v1);
      const v2 = await var2.get();
      console.log('V2', v2);
      expect(v1).to.deep.equal(v2);
    });
    it('enables referenceMode by default', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text value
      `);

      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let key1 = newStoreKey('varPtr');

      let var1 = await storage.construct('test0', BarType, key1);
      await var1.set({ id: 'id1', value: 'underlying' });

      let result = await var1.get();
      assert.equal('underlying', result.value);

      assert.isTrue(var1.referenceMode);
      assert.isNotNull(var1.backingStore);

      assert.deepEqual(await var1.backingStore.get('id1'), await var1.get());
    });
    it('supports references', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text value
      `);

      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let key1 = newStoreKey('varPtr');

      let var1 = await storage.construct('test0', Type.newReference(BarType), key1);
      await var1.set({ id: 'id1', storageKey: 'underlying' });

      let result = await var1.get();
      assert.equal('underlying', result.storageKey);

      assert.isFalse(var1.referenceMode);
      assert.isNull(var1.backingStore);
    });
  });

  describe('collection', () => {
    it('supports basic construct and mutate', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text value
      `);
      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let value1 = 'Hi there' + Math.random();
      let value2 = 'Goodbye' + Math.random();
      let collection = await storage.construct('test1', BarType.collectionOf(), newStoreKey('collection'));
      await collection.store({ id: 'test0:test0', value: value1 }, ['key0']);
      await collection.store({ id: 'test0:test1', value: value2 }, ['key1']);
      let result = await collection.get('test0:test0');
      expect(result.value).to.equal(value1);
      result = await collection.toList();
      expect(result).to.have.lengthOf(2);
      expect(result[0].value).to.equal(value1);
      expect(result[0].id).to.equal('test0:test0');
      expect(result[1].value).to.equal(value2);
      expect(result[1].id).to.equal('test0:test1'); // TODO(lindner): should be test1:test1???
    });
    it('resolves concurrent add of same id', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text value
      `);
      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let key = newStoreKey('collection');
      let collection1 = await storage.construct('test1', BarType.collectionOf(), key);
      let collection2 = await storage.connect(
        'test1',
        BarType.collectionOf(),
        key
      );
      const c1 = collection1.store({ id: 'id1', value: 'value' }, ['key3']);
      await collection2.store({ id: 'id1', value: 'value' }, ['key4']);
      await c1;
      expect(await collection1.toList()).to.deep.equal(await collection2.toList());
    });

    it('resolves concurrent add/remove of same id', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text value
      `);
      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let key = newStoreKey('collection');
      let collection1 = await storage.construct('test1', BarType.collectionOf(), key);
      let collection2 = await storage.connect(
        'test1',
        BarType.collectionOf(),
        key
      );
      await Promise.all([
        collection1.store({ id: 'id1', value: 'value' }, ['key1']),
        collection2.store({ id: 'id1', value: 'value' }, ['key2'])
      ]);
      await Promise.all([collection1.remove('id1', ['key1']), collection2.remove('id1', ['key2'])]);
      expect(await collection1.toList()).to.be.empty;
      expect(await collection2.toList()).to.be.empty;
    });
    it('resolves concurrent add of different id', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text value
      `);
      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let key = newStoreKey('collection');
      let collection1 = await storage.construct('test1', BarType.collectionOf(), key);
      let collection2 = await storage.connect(
        'test1',
        BarType.collectionOf(),
        key
      );
      await collection1.store({ id: 'id1', value: 'value1' }, ['key1']);
      await collection2.store({ id: 'id2', value: 'value2' }, ['key2']);
      expect(await collection1.toList()).to.have.lengthOf(2);
      expect(await collection1.toList()).to.have.deep.members(await collection2.toList());
    });
    it('enables referenceMode by default', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text value
      `);

      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let key1 = newStoreKey('colPtr');

      let collection1 = await storage.construct('test0', BarType.collectionOf(), key1);

      await collection1.store({ id: 'id1', value: 'value1' }, ['key1']);
      await collection1.store({ id: 'id2', value: 'value2' }, ['key2']);

      let result = await collection1.get('id1');
      assert.equal('value1', result.value);
      result = await collection1.get('id2');
      assert.equal('value2', result.value);

      assert.isTrue(collection1.referenceMode);
      assert.isNotNull(collection1.backingStore);

      assert.deepEqual(await collection1.backingStore.get('id1'), await collection1.get('id1'));
      assert.deepEqual(await collection1.backingStore.get('id2'), await collection1.get('id2'));
    });
    it('supports references', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text value
      `);

      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let key1 = newStoreKey('colPtr');

      let collection1 = await storage.construct('test0', Type.newReference(BarType).collectionOf(), key1);

      await collection1.store({ id: 'id1', storageKey: 'value1' }, ['key1']);
      await collection1.store({ id: 'id2', storageKey: 'value2' }, ['key2']);

      let result = await collection1.get('id1');
      assert.equal('value1', result.storageKey);
      result = await collection1.get('id2');
      assert.equal('value2', result.storageKey);

      assert.isFalse(collection1.referenceMode);
      assert.isNull(collection1.backingStore);
    });
  });

  // For these tests, the following index rule should be manually set up in the console at
  // https://firebase.corp.google.com/project/arcs-storage-test/database/arcs-storage-test/rules:
  //   "rules": {
  //     "firebase-storage-test": {
  //       "$collection": {
  //         "items": {
  //           ".indexOn": ["index"]
  //         }
  //       }
  //     }
  //   }
  describe('big collection', () => {
    it.skip('supports get, store and remove (including concurrently)', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text data
      `);
      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let key = newStoreKey('bigcollection');
      let collection1 = await storage.construct('test0', BarType.bigCollectionOf(), key);
      let collection2 = await storage.connect(
        'test0',
        BarType.bigCollectionOf(),
        key
      );

      // Concurrent writes to different ids.
      await Promise.all([collection1.store({ id: 'id1', data: 'ab' }, ['k34']), collection2.store({ id: 'id2', data: 'cd' }, ['k12'])]);
      assert.equal((await collection2.get('id1')).data, 'ab');
      assert.equal((await collection1.get('id2')).data, 'cd');

      await collection1.remove('id2');
      assert.isNull(await collection2.get('id2'));

      // Concurrent writes to the same id.
      await Promise.all([collection1.store({ id: 'id3', data: 'xx' }, ['k65']), collection2.store({ id: 'id3', data: 'yy' }, ['k87'])]);
      assert.include(['xx', 'yy'], (await collection1.get('id3')).data);

      assert.isNull(await collection1.get('non-existent'));
      await collection1.remove('non-existent');
    });

    // Ideally this would be several independent test cases, but since we're using a live remote
    // database instance the setup is too expensive to keep repeating.
    it.skip('supports version-stable streamed reads', async () => {
      let manifest = await Manifest.parse(`
        schema Bar
          Text data
      `);
      let arc = new Arc({ id: 'test' });
      let storage = createStorage(arc.id);
      let BarType = Type.newEntity(manifest.schemas.Bar);
      let collection = await storage.construct('test0', BarType.bigCollectionOf(), newStoreKey('bigcollection'));
      let items = new Map();

      // Stores a new item for each id in both collection and items, with data and key derived
      // from the numerical part of the id in a lexicographically "random" manner.
      let store = (...ids) => {
        let promises = [];
        for (let id of ids) {
          let n = Number(id.slice(1));
          let data = 'v' + ((n * 37) % 100);
          let key = 'k' + ((n * 73) % 100);
          promises.push(collection.store({ id, data }, [key]));
          items.set(id, { data, key });
        }
        return Promise.all(promises);
      };

      // Add an initial set of items with lexicographically "random" ids.
      await store('r01', 'i02', 'z03', 'q04', 'h05', 'y06', 'p07', 'g08');

      // Verifies that cursor.next() returns items matching the given list of ids (in order).
      let checkNext = async (cursorId, ids) => {
        let { value, done } = await collection.cursorNext(cursorId);
        assert.isFalse(done);
        assert.equal(value.length, ids.length);
        for (let i = 0; i < value.length; i++) {
          assert.equal(value[i].id, ids[i]);
          assert.equal(value[i].data, items.get(ids[i]).data);
        }
      };

      // Verifies that cursor does not contain any more items.
      let checkDone = async cursorId => {
        let { value, done } = await collection.cursorNext(cursorId);
        assert.isTrue(done);
        assert.isUndefined(value);
      };

      // Verifies a full streamed read with the given page size.
      let checkStream = async (pageSize, ...idRows) => {
        let cursorId = await collection.stream(pageSize);
        for (let ids of idRows) {
          await checkNext(cursorId, ids);
        }
        await checkDone(cursorId);
      };

      // Test streamed reads with various page sizes.
      await checkStream(3, ['r01', 'i02', 'z03'], ['q04', 'h05', 'y06'], ['p07', 'g08']);
      await checkStream(4, ['r01', 'i02', 'z03', 'q04'], ['h05', 'y06', 'p07', 'g08']);
      await checkStream(7, ['r01', 'i02', 'z03', 'q04', 'h05', 'y06', 'p07'], ['g08']);
      await checkStream(8, ['r01', 'i02', 'z03', 'q04', 'h05', 'y06', 'p07', 'g08']);

      await store('x09', 'o10', 'f11', 'w12', 'e13', 'j14');

      // Add operations that occur after cursor creation should not affect streamed reads.
      // Items removed "ahead" of the read should be captured and returned later in the stream.
      let cursorId1 = await collection.stream(4);

      // Remove the item at the start of the first page and another from a later page.
      await collection.remove('r01');
      await collection.remove('p07');
      await store('t15');
      await checkNext(cursorId1, ['i02', 'z03', 'q04', 'h05']);

      // Interleave another streamed read over a different version of the collection. cursor2
      // should be 3 versions ahead due to the 3 add/remove operations above.
      let cursorId2 = await collection.stream(5);
      assert.equal(collection.cursorVersion(cursorId2), collection.cursorVersion(cursorId1) + 3);
      await store('s16');

      // For cursor1: remove one item from the page just returned and two at the edges of the next page.
      await collection.remove('z03');
      await collection.remove('y06');
      await collection.remove('f11');

      await checkNext(cursorId2, ['i02', 'q04', 'h05', 'g08', 'x09']);
      await checkNext(cursorId1, ['g08', 'x09', 'o10', 'w12']);

      // This uses up the remaining non-removed items for cursor2 ---> [*]
      await checkNext(cursorId2, ['o10', 'w12', 'e13', 'j14', 't15']);

      // For cursor1: the next page should include the two remaining items and two of the previously
      // removed ones (which are returned in reverse order of removal).
      await checkNext(cursorId1, ['e13', 'j14', 'f11', 'y06']);

      // Remove another previously-returned item; should have no effect on either cursor.
      await collection.remove('x09');
      await checkNext(cursorId1, ['p07', 'r01']);
      await store('m17');
      await checkDone(cursorId1);

      // Streaming again should be up-to-date (even with cursor2 still in flight).
      await checkStream(12, ['i02', 'q04', 'h05', 'g08', 'o10', 'w12', 'e13', 'j14', 't15', 's16', 'm17']);

      // [*] ---> so that this page is only removed items.
      await checkNext(cursorId2, ['f11', 'y06', 'z03']);
      await checkDone(cursorId2);

      // Repeated next() calls on a finished cursor should be safe.
      await checkDone(cursorId2);

      // close() should terminate a stream.
      let cursorId3 = await collection.stream(3);
      await checkNext(cursorId3, ['i02', 'q04', 'h05']);
      collection.cursorClose(cursorId3);
      await checkDone(cursorId3);
    }).timeout(20000);
  });

  // These tests use data manually added to our test firebase db.
  describe('synthetic', () => {
    function getKey(manifestName) {
      let fbKey = testUrl.replace('firebase-storage-test', `synthetic-storage-data/${manifestName}`);
      return `synthetic://arc/handles/${fbKey}`;
    }

    it.skip('simple test', async () => {
      let storage = createStorage('arc-id');
      let synth = await storage.connect(
        'id1',
        null,
        getKey('simple-manifest')
      );
      let list = await synth.toList();
      assert.equal(list.length, 1);
      let handle = list[0];
      assert.equal(handle.storageKey, 'firebase://xxx.firebaseio.com/yyy');
      let type = handle.type.getContainedType();
      assert(type && type.isEntity);
      assert.equal(type.entitySchema.name, 'Thing');
      assert.deepEqual(handle.tags, ['taggy']);
    });

    it.skip('error test', async () => {
      let storage = createStorage('arc-id');
      let synth1 = await storage.connect(
        'not-there',
        null,
        getKey('not-there')
      );
      let list1 = await synth1.toList();
      assert.isEmpty(list1, 'synthetic handle list should empty for non-existent storageKey');

      let synth2 = await storage.connect(
        'bad-manifest',
        null,
        getKey('bad-manifest')
      );
      let list2 = await synth2.toList();
      assert.isEmpty(list2, 'synthetic handle list should empty for invalid manifests');

      let synth3 = await storage.connect(
        'no-recipe',
        null,
        getKey('no-recipe')
      );
      let list3 = await synth3.toList();
      assert.isEmpty(list3, 'synthetic handle list should empty for manifests with no active recipe');

      let synth4 = await storage.connect(
        'no-handles',
        null,
        getKey('no-handles')
      );
      let list4 = await synth4.toList();
      assert.isEmpty(list4, 'synthetic handle list should empty for manifests with no handles');
    });

    it.skip('large test', async () => {
      let storage = createStorage('arc-id');
      let synth = await storage.connect(
        'id1',
        null,
        getKey('large-manifest')
      );
      let list = await synth.toList();
      assert(list.length > 0, 'synthetic handle list should not be empty');
      for (let item of list) {
        assert(item.storageKey.startsWith('firebase:'));
        assert(item.type.constructor.name == 'Type');
        if (item.tags.length > 0) {
          assert.isString(item.tags[0]);
        }
      }
    });
  });
});
