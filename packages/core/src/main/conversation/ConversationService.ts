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

import {
  ClientMismatch,
  NewOTRMessage,
  OTRRecipients,
  UserClients,
} from '@wireapp/api-client/dist/commonjs/conversation/index';
import {CONVERSATION_TYPING} from '@wireapp/api-client/dist/commonjs/event/index';
import {UserPreKeyBundleMap} from '@wireapp/api-client/dist/commonjs/user/index';
import {AxiosError} from 'axios';
import {Encoder} from 'bazinga64';
import {
  AssetService,
  ClientAction,
  ConfirmationType,
  GenericMessageType,
  Image,
  ImageAsset,
  RemoteData,
} from '../conversation/root';
import * as AssetCryptography from '../cryptography/AssetCryptography.node';
import {PayloadBundleState} from '../cryptography/PayloadBundle';
import {CryptographyService, EncryptedAsset, PayloadBundle} from '../cryptography/root';

const UUID = require('pure-uuid');
import APIClient = require('@wireapp/api-client');

export default class ConversationService {
  private clientID: string = '';

  constructor(
    private readonly apiClient: APIClient,
    private readonly protocolBuffers: any = {},
    private readonly cryptographyService: CryptographyService,
    private readonly assetService: AssetService
  ) {}

  // TODO: The correct functionality of this function is heavily based on the case that it always runs into the catch
  // block
  private getPreKeyBundles(conversationId: string): Promise<ClientMismatch | UserPreKeyBundleMap> {
    return this.apiClient.conversation.api.postOTRMessage(this.clientID, conversationId).catch((error: AxiosError) => {
      if (error.response && error.response.status === 412) {
        const recipients: UserClients = error.response.data.missing;
        return this.apiClient.user.api.postMultiPreKeyBundles(recipients);
      }
      throw error;
    });
  }

  private async sendExternalGenericMessage(
    sendingClientId: string,
    conversationId: string,
    asset: EncryptedAsset,
    preKeyBundles: UserPreKeyBundleMap
  ): Promise<ClientMismatch> {
    const {cipherText, keyBytes, sha256} = asset;
    const messageId = ConversationService.createId();

    const externalMessage = this.protocolBuffers.External.create({
      otrKey: new Uint8Array(keyBytes),
      sha256: new Uint8Array(sha256),
    });

    const base64CipherText = Encoder.toBase64(cipherText).asString;

    const customTextMessage = this.protocolBuffers.GenericMessage.create({
      external: externalMessage,
      messageId,
    });

    const plainTextBuffer: Buffer = this.protocolBuffers.GenericMessage.encode(customTextMessage).finish();
    const recipients = await this.cryptographyService.encrypt(plainTextBuffer, preKeyBundles as UserPreKeyBundleMap);

    const message: NewOTRMessage = {
      data: base64CipherText,
      recipients,
      sender: sendingClientId,
    };

    return this.apiClient.conversation.api.postOTRMessage(sendingClientId, conversationId, message);
  }

  private async sendGenericMessage(
    sendingClientId: string,
    conversationId: string,
    genericMessage: any
  ): Promise<ClientMismatch> {
    const plainTextBuffer: Buffer = this.protocolBuffers.GenericMessage.encode(genericMessage).finish();
    const preKeyBundles = await this.getPreKeyBundles(conversationId);
    const recipients = await this.cryptographyService.encrypt(plainTextBuffer, preKeyBundles as UserPreKeyBundleMap);

    return this.sendMessage(sendingClientId, conversationId, recipients);
  }

  private sendMessage(
    sendingClientId: string,
    conversationId: string,
    recipients: OTRRecipients
  ): Promise<ClientMismatch> {
    const message: NewOTRMessage = {
      recipients,
      sender: sendingClientId,
    };
    return this.apiClient.conversation.api.postOTRMessage(sendingClientId, conversationId, message);
  }

  private shouldSendAsExternal(plainText: Buffer, preKeyBundles: UserPreKeyBundleMap): boolean {
    const EXTERNAL_MESSAGE_THRESHOLD_BYTES = 200 * 1024;

    let clientCount = 0;
    for (const user in preKeyBundles) {
      clientCount += Object.keys(preKeyBundles[user]).length;
    }

    const messageInBytes = new Uint8Array(plainText).length;
    const estimatedPayloadInBytes = clientCount * messageInBytes;

    return estimatedPayloadInBytes > EXTERNAL_MESSAGE_THRESHOLD_BYTES;
  }

  public static createId(): string {
    return new UUID(4).format();
  }

  public async createImage(image: Image, messageId: string = ConversationService.createId()): Promise<PayloadBundle> {
    const imageAsset = await this.assetService.uploadImageAsset(image);

    return {
      content: {
        asset: imageAsset,
        image,
      },
      from: this.clientID,
      id: messageId,
      state: PayloadBundleState.OUTGOING_UNSENT,
      type: GenericMessageType.ASSET,
    };
  }

  public async createText(message: string, messageId: string = ConversationService.createId()): Promise<PayloadBundle> {
    return {
      content: message,
      from: this.clientID,
      id: messageId,
      state: PayloadBundleState.OUTGOING_UNSENT,
      type: GenericMessageType.TEXT,
    };
  }

  public async getImage({assetId, otrKey, sha256, assetToken}: RemoteData): Promise<Buffer> {
    const encryptedBuffer = await this.apiClient.asset.api.getAsset(assetId, assetToken);
    return AssetCryptography.decryptAsset({
      cipherText: Buffer.from(encryptedBuffer),
      keyBytes: Buffer.from(otrKey.buffer),
      sha256: Buffer.from(sha256.buffer),
    });
  }

  public async sendConfirmation(conversationId: string, confirmMessageId: string): Promise<PayloadBundle> {
    const messageId = ConversationService.createId();

    const confirmation = this.protocolBuffers.Confirmation.create({
      firstMessageId: confirmMessageId,
      type: ConfirmationType.DELIVERED,
    });

    const genericMessage = this.protocolBuffers.GenericMessage.create({
      confirmation,
      messageId,
    });

    await this.sendGenericMessage(this.clientID, conversationId, genericMessage);

    return {
      conversation: conversationId,
      from: this.clientID,
      id: messageId,
      state: PayloadBundleState.OUTGOING_SENT,
      type: GenericMessageType.CONFIRMATION,
    };
  }

  public async sendImage(conversationId: string, payloadBundle: PayloadBundle): Promise<PayloadBundle> {
    if (!payloadBundle.content) {
      throw new Error('No content for sendImage provided!');
    }

    const encryptedAsset = payloadBundle.content as ImageAsset;

    const imageMetadata = this.protocolBuffers.Asset.ImageMetaData.create({
      height: encryptedAsset.image.height,
      width: encryptedAsset.image.width,
    });

    const original = this.protocolBuffers.Asset.Original.create({
      image: imageMetadata,
      mimeType: encryptedAsset.image.type,
      name: null,
      size: encryptedAsset.image.data.length,
    });

    const remoteData = this.protocolBuffers.Asset.RemoteData.create({
      assetId: encryptedAsset.asset.key,
      assetToken: encryptedAsset.asset.token,
      otrKey: encryptedAsset.asset.keyBytes,
      sha256: encryptedAsset.asset.sha256,
    });

    const asset = this.protocolBuffers.Asset.create({
      original,
      uploaded: remoteData,
    });

    const genericMessage = this.protocolBuffers.GenericMessage.create({
      asset,
      messageId: payloadBundle.id,
    });

    const preKeyBundles = await this.getPreKeyBundles(conversationId);
    const plainTextBuffer: Buffer = this.protocolBuffers.GenericMessage.encode(genericMessage).finish();
    const payload: EncryptedAsset = await AssetCryptography.encryptAsset(plainTextBuffer);

    await this.sendExternalGenericMessage(this.clientID, conversationId, payload, preKeyBundles as UserPreKeyBundleMap);
    return {...payloadBundle, state: PayloadBundleState.OUTGOING_SENT};
  }

  public async sendPing(conversationId: string): Promise<PayloadBundle> {
    const messageId = ConversationService.createId();

    const knock = this.protocolBuffers.Knock.create();
    const genericMessage = this.protocolBuffers.GenericMessage.create({
      knock,
      messageId,
    });

    await this.sendGenericMessage(this.clientID, conversationId, genericMessage);

    return {
      conversation: conversationId,
      from: this.clientID,
      id: messageId,
      state: PayloadBundleState.OUTGOING_SENT,
      type: GenericMessageType.KNOCK,
    };
  }

  public async sendSessionReset(conversationId: string): Promise<PayloadBundle> {
    const messageId = ConversationService.createId();

    const sessionReset = this.protocolBuffers.GenericMessage.create({
      clientAction: ClientAction.RESET_SESSION,
      messageId,
    });

    await this.sendGenericMessage(this.clientID, conversationId, sessionReset);
    return {
      conversation: conversationId,
      from: this.clientID,
      id: messageId,
      state: PayloadBundleState.OUTGOING_SENT,
      type: GenericMessageType.CLIENT_ACTION,
    };
  }

  public async sendText(conversationId: string, originalPayloadBundle: PayloadBundle): Promise<PayloadBundle> {
    const payloadBundle = {...originalPayloadBundle, state: PayloadBundleState.OUTGOING_SENT};
    const genericMessage = this.protocolBuffers.GenericMessage.create({
      messageId: payloadBundle.id,
      text: this.protocolBuffers.Text.create({content: payloadBundle.content}),
    });

    const preKeyBundles = await this.getPreKeyBundles(conversationId);
    const plainTextBuffer: Buffer = this.protocolBuffers.GenericMessage.encode(genericMessage).finish();

    if (this.shouldSendAsExternal(plainTextBuffer, preKeyBundles as UserPreKeyBundleMap)) {
      const encryptedAsset: EncryptedAsset = await AssetCryptography.encryptAsset(plainTextBuffer);

      await this.sendExternalGenericMessage(
        this.clientID,
        conversationId,
        encryptedAsset,
        preKeyBundles as UserPreKeyBundleMap
      );
      return payloadBundle;
    }

    const payload: OTRRecipients = await this.cryptographyService.encrypt(
      plainTextBuffer,
      preKeyBundles as UserPreKeyBundleMap
    );

    await this.sendMessage(this.clientID, conversationId, payload);
    return payloadBundle;
  }

  public sendTypingStart(conversationId: string): Promise<void> {
    return this.apiClient.conversation.api.postTyping(conversationId, {status: CONVERSATION_TYPING.STARTED});
  }

  public sendTypingStop(conversationId: string): Promise<void> {
    return this.apiClient.conversation.api.postTyping(conversationId, {status: CONVERSATION_TYPING.STOPPED});
  }

  public setClientID(clientID: string) {
    this.clientID = clientID;
  }

  public async updateText(conversationId: string, originalMessageId: string, newMessage: string): Promise<string> {
    const messageId = ConversationService.createId();

    const editedMessage = this.protocolBuffers.MessageEdit.create({
      replacingMessageId: originalMessageId,
      text: this.protocolBuffers.Text.create({content: newMessage}),
    });

    const genericMessage = this.protocolBuffers.GenericMessage.create({
      edited: editedMessage,
      messageId,
    });

    const preKeyBundles = await this.getPreKeyBundles(conversationId);
    const plainTextBuffer: Buffer = this.protocolBuffers.GenericMessage.encode(genericMessage).finish();
    const payload: EncryptedAsset = await AssetCryptography.encryptAsset(plainTextBuffer);

    await this.sendExternalGenericMessage(this.clientID, conversationId, payload, preKeyBundles as UserPreKeyBundleMap);
    return messageId;
  }
}
