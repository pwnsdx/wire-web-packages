/*
 * Wire
 * Copyright (C) 2018 Wire Swiss GmbH
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see http://www.gnu.org/licenses/.
 *
 */

import {AxiosResponse} from 'axios';
import {HttpClient} from '../http';
import {base64MD5FromBuffer, concatToBuffer} from '../shims/node/buffer';
import {unsafeAlphanumeric} from '../shims/node/random';
import {AssetRetentionPolicy} from './AssetRetentionPolicy';
import {AssetUploadData} from './AssetUploadData';
import {isValidKey, isValidToken} from './AssetUtil';

class AssetAPI {
  private static readonly ASSET_URL = '/assets/v3';

  constructor(private readonly client: HttpClient) {}

  getAsset(key: string, token?: string): Promise<ArrayBuffer> {
    if (!isValidKey(key)) {
      throw TypeError('Expected key to only contain alphanumeric values and dashes.');
    }

    if (token && !isValidToken(token)) {
      throw TypeError('Expected token to be base64 encoded string.');
    }

    return this.client
      .sendRequest(
        {
          method: 'get',
          params: {
            asset_token: token,
          },
          responseType: 'arraybuffer',
          url: `${AssetAPI.ASSET_URL}/${key}`,
        },
        true
      )
      .then((response: AxiosResponse) => response.data);
  }

  postAsset(asset: Uint8Array, options?: {public: boolean; retention: AssetRetentionPolicy}): Promise<AssetUploadData> {
    const BOUNDARY = `Frontier${unsafeAlphanumeric()}`;

    const metadata = JSON.stringify({
      public: true,
      retention: AssetRetentionPolicy.PERSISTENT,
      ...options,
    });

    let body = '';

    body += `--${BOUNDARY}\r\n`;
    body += 'Content-Type: application/json;charset=utf-8\r\n';
    body += `Content-length: ${metadata.length}\r\n`;
    body += '\r\n';
    body += `${metadata}\r\n`;

    body += `--${BOUNDARY}\r\n`;
    body += 'Content-Type: application/octet-stream\r\n';
    body += `Content-length: ${asset.length}\r\n`;
    body += `Content-MD5: ${base64MD5FromBuffer(asset.buffer)}\r\n`;
    body += '\r\n';

    const footer = `\r\n--${BOUNDARY}--\r\n`;

    return this.client
      .sendRequest({
        data: concatToBuffer(body, asset, footer),
        headers: {
          'Content-Type': `multipart/mixed; boundary=${BOUNDARY}`,
        },
        method: 'post',
        url: AssetAPI.ASSET_URL,
      })
      .then((response: AxiosResponse) => response.data);
  }
}

export {AssetAPI};
