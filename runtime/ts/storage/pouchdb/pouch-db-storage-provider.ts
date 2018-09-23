import {StorageProviderBase} from "../storage-provider-base.js";

import {PouchDbCollection} from "./pouch-db-collection.js";
import {PouchDbStorage} from "./pouch-db-storage.js";
import {PouchDbKey} from "./pouch-db-key.js";
import {Type} from "../../type.js";

/**
 * Base class for PouchDb related Storage classes
 * (PouchDbVariable/PouchDbCollection)
 */
export abstract class PouchDbStorageProvider extends StorageProviderBase {
  /** The Storage Engine instance we were initialized with */
  protected storageEngine: PouchDbStorage;

  // Manages backing store
  protected backingStore: PouchDbCollection|null = null;
  private pendingBackingStore: Promise<PouchDbCollection>|null = null;

  /** The PouchDbKey for this Collection */
  protected readonly pouchDbKey: PouchDbKey;
  /** The Pouch revision of the data we have stored locally */
  protected _rev: string | undefined;

  constructor(type: Type, storageEngine: PouchDbStorage, name: string, id: string, key: string) {
    super(type, name, id, key);
    this.storageEngine = storageEngine;
    this.pouchDbKey = new PouchDbKey(key);
  }

  // A consequence of awaiting this function is that this.backingStore
  // is guaranteed to exist once the await completes. This is because
  // if backingStore doesn't yet exist, the assignment in the then()
  // is guaranteed to execute before anything awaiting this function.
  async ensureBackingStore() {
    if (this.backingStore) {
      return this.backingStore;
    }
    if (!this.pendingBackingStore) {
      const key = this.storageEngine.baseStorageKey(this.backingType(), this.storageKey);
      this.pendingBackingStore = this.storageEngine.baseStorageFor(this.type, key);
      this.pendingBackingStore.then(backingStore => this.backingStore = backingStore);
    }
    return this.pendingBackingStore;
  }

  abstract backingType(): Type;

  /**
   * The active database for this provider.
   */
  protected get db(): PouchDB.Database {
    // TODO(lindner) vary the db by the storage key
    return this.storageEngine.dbForKey(this.pouchDbKey);;
  }
}
