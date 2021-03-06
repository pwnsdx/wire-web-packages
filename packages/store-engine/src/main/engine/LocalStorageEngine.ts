import CRUDEngine from './CRUDEngine';
import {isBrowser} from './EnvironmentUtil';
import {RecordAlreadyExistsError, RecordNotFoundError, RecordTypeError, UnsupportedError} from './error';

export default class LocalStorageEngine implements CRUDEngine {
  public storeName: string = '';

  public async isSupported(): Promise<void> {
    if (!isBrowser() || !window.localStorage) {
      const message = `LocalStorage is not available on your platform.`;
      throw new UnsupportedError(message);
    }
  }

  public async init(storeName: string): Promise<any> {
    await this.isSupported();
    this.storeName = storeName;
  }

  public async purge(): Promise<void> {
    window.localStorage.clear();
  }

  private createKey(tableName: string, primaryKey: string): string {
    return `${this.storeName}@${tableName}@${primaryKey}`;
  }

  public create<T>(tableName: string, primaryKey: string, entity: T): Promise<string> {
    if (entity) {
      const key: string = this.createKey(tableName, primaryKey);
      return this.read(tableName, primaryKey)
        .catch(error => {
          if (error instanceof RecordNotFoundError) {
            return undefined;
          }
          throw error;
        })
        .then(record => {
          if (record) {
            const message: string = `Record "${primaryKey}" already exists in "${tableName}". You need to delete the record first if you want to overwrite it.`;
            throw new RecordAlreadyExistsError(message);
          } else {
            if (typeof record === 'string') {
              window.localStorage.setItem(key, String(entity));
            } else {
              window.localStorage.setItem(key, JSON.stringify(entity));
            }
            return primaryKey;
          }
        });
    }
    const message: string = `Record "${primaryKey}" cannot be saved in "${tableName}" because it's "undefined" or "null".`;
    return Promise.reject(new RecordTypeError(message));
  }

  public delete(tableName: string, primaryKey: string): Promise<string> {
    return Promise.resolve().then(() => {
      const key: string = this.createKey(tableName, primaryKey);
      window.localStorage.removeItem(key);
      return primaryKey;
    });
  }

  public deleteAll(tableName: string): Promise<boolean> {
    return Promise.resolve().then(() => {
      Object.keys(localStorage).forEach((key: string) => {
        const prefix: string = `${this.storeName}@${tableName}@`;
        if (key.startsWith(prefix)) {
          localStorage.removeItem(key);
        }
      });
      return true;
    });
  }

  public read<T>(tableName: string, primaryKey: string): Promise<T> {
    return Promise.resolve().then(() => {
      const key: string = `${this.storeName}@${tableName}@${primaryKey}`;
      const record = window.localStorage.getItem(key);
      if (record) {
        try {
          return JSON.parse(record);
        } catch (error) {
          return record;
        }
      }
      const message: string = `Record "${primaryKey}" in "${tableName}" could not be found.`;
      throw new RecordNotFoundError(message);
    });
  }

  public readAll<T>(tableName: string): Promise<T[]> {
    const promises: Array<Promise<T>> = [];

    Object.keys(localStorage).forEach((key: string) => {
      const prefix: string = `${this.storeName}@${tableName}@`;
      if (key.startsWith(prefix)) {
        const primaryKey = key.replace(prefix, '');
        promises.push(this.read(tableName, primaryKey));
      }
    });

    return Promise.all(promises);
  }

  public readAllPrimaryKeys(tableName: string): Promise<string[]> {
    const primaryKeys: Array<string> = [];

    Object.keys(localStorage).forEach((primaryKey: string) => {
      const prefix: string = `${this.storeName}@${tableName}@`;
      if (primaryKey.startsWith(prefix)) {
        primaryKeys.push(primaryKey.replace(prefix, ''));
      }
    });

    return Promise.resolve(primaryKeys);
  }

  public update(tableName: string, primaryKey: string, changes: Object): Promise<string> {
    return this.read(tableName, primaryKey)
      .then((entity: Object) => {
        return {...entity, ...changes};
      })
      .then((updatedEntity: Object) => {
        return this.create(tableName, primaryKey, updatedEntity).catch(error => {
          if (error instanceof RecordAlreadyExistsError) {
            return this.delete(tableName, primaryKey).then(() => this.create(tableName, primaryKey, updatedEntity));
          } else {
            throw error;
          }
        });
      });
  }

  public updateOrCreate(tableName: string, primaryKey: string, changes: Object): Promise<string> {
    return this.update(tableName, primaryKey, changes)
      .catch(error => {
        if (error instanceof RecordNotFoundError) {
          return this.create(tableName, primaryKey, changes);
        }
        throw error;
      })
      .then(() => primaryKey);
  }

  append(tableName: string, primaryKey: string, additions: string): Promise<string> {
    return this.read(tableName, primaryKey).then((record: any) => {
      if (typeof record === 'string') {
        record += additions;
      } else {
        const message: string = `Cannot append text to record "${primaryKey}" because it's not a string.`;
        throw new RecordTypeError(message);
      }

      const key: string = this.createKey(tableName, primaryKey);
      window.localStorage.setItem(key, record);

      return primaryKey;
    });
  }
}
