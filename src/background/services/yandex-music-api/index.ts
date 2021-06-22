import https from 'https';
import {IncomingMessage} from 'http';
import {URL} from 'url';
import md5 from 'md5';

import {
  Track,
  Album,
  Playlist,
  Artist,
  Lyric,
  DownloadPartialCallback,
  YandexMusicAPI as IYandexMusicAPI,
} from './interfaces';

/**
 * Info about track's file
 */
type TrackDownloadInfo = {
  readonly codec: string /* should be mp3 */;
  readonly bitrate: number;
  readonly src: string;
  readonly gain: boolean;
  /* true if only preview version is available for you */
  readonly preview: boolean;
};
/**
 * Data needed to download file from storage
 */
type FileDownloadInfo = {
  readonly s: string;
  readonly ts: string;
  readonly path: string;
  readonly host: string;
};

/**
 * Implementation of yandex api functional
 */
export class YandexMusicAPI implements IYandexMusicAPI {
  protected locale_: string;
  protected headers_: {[header: string]: string};
  /**
   * @return hostname of current instance
   * of YandexMusicAPI
   */
  private getHostname(): string {
    return `music.yandex.${this.locale_}`;
  }
  /**
   * Does a GET request to specified host and path
   * @return result of request in format of string
   */
  private async getString(hostname: string, path: string): Promise<string> {
    const options = {
      hostname: hostname,
      path: path,
      headers: this.headers_,
    };

    return new Promise<string>((resolve, reject) => {
      https
        .get(options, (res: IncomingMessage) => {
          let rawData = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => (rawData += chunk || ''));
          res.on('error', reject);
          res.on('end', () => resolve(rawData));
        })
        .on('error', reject);
    });
  }
  /**
   * Does a GET request to specified host and path
   * @return parsed json casted to provided type
   */
  private async getObject<T>(hostname: string, path: string): Promise<T> {
    return JSON.parse(await this.getString(hostname, path)) as T;
  }
  /**
   * Does a GET request to specified host and path
   * @return binary buffer
   */
  private async getBuffer(
    hostname: string,
    path: string,
    partialCallback?: DownloadPartialCallback
  ): Promise<Buffer> {
    const options = {
      hostname: hostname,
      path: path,
      headers: this.headers_,
    };

    return new Promise<Buffer>((resolve, reject) => {
      https.get(options, (res: IncomingMessage) => {
        const rawData: Buffer[] = [];

        let currentChunkSize = 0;
        const totalSize = +(res.headers['content-length'] || -1);

        res.on('data', (chunk: Buffer) => {
          rawData.push(chunk);
          currentChunkSize += chunk.byteLength;

          if (currentChunkSize >= 16384 && partialCallback) {
            partialCallback(totalSize, currentChunkSize);
            currentChunkSize = 0;
          }
        });
        res.on('error', reject);
        res.on('end', () => {
          if (currentChunkSize && partialCallback) {
            partialCallback(totalSize, currentChunkSize);
          }
          resolve(Buffer.concat(rawData));
        });
      });
    });
  }
  /**
   * Creates new instance of YandexMusicAPI with specified locale
   * @example new YandexMusicAPI('by')
   */
  constructor(locale = 'ru') {
    this.locale_ = locale;
    this.headers_ = {
      'X-Retpath-Y': encodeURI(`https://${this.getHostname()}/`),
      Connection: 'keep-alive',
      Accept: '*/*',
    };
  }
  /**
   * @return track info from '/handlers/track.jsx'
   */
  async getTrack(
    trackId: number,
    albumId: number
  ): Promise<{
    readonly artists: Artist[];
    readonly otherVersions: {[version: string]: Track[]};
    readonly alsoInAlbums: Album[];
    readonly similarTracks: Track[];
    readonly track: Track;
    readonly lyric: Lyric[];
  }> {
    return await this.getObject(
      this.getHostname(),
      `/handlers/track.jsx?track=${trackId}:${albumId}`
    );
  }
  /**
   * @return album info from '/handlers/album.jsx'
   */
  async getAlbum(albumId: number): Promise<Album> {
    return await this.getObject(
      this.getHostname(),
      `/handlers/album.jsx?album=${albumId}`
    );
  }
  /**
   * @return artist info from '/handlers/artist.jsx'
   */
  async getArtist(artistId: number): Promise<{
    readonly artist: Artist;
    readonly similar: Artist[];
    readonly allSimilar: Artist[];
    readonly albums: Album[];
    readonly alsoAlbums: Album[];
    readonly tracks: Track[];
    readonly playlistIds: {
      readonly uid: number;
      readonly kind: number;
    }[];
    readonly playlists: Playlist[];
    readonly trackIds: number[];
  }> {
    return await this.getObject(
      this.getHostname(),
      `/handlers/artist.jsx?artist=${artistId}`
    );
  }
  /**
   * @return playlist info from '/handlers/playlist.jsx'
   */
  async getPlaylist(uid: number, kind: number): Promise<{playlist: Playlist}> {
    return await this.getObject(
      this.getHostname(),
      `/handlers/playlist.jsx?owner=${uid}&kinds=${kind}`
    );
  }
  /**
   * @return link to track's mp3 file
   */
  async getTrackDownloadLink(
    trackId: number,
    albumId: number
  ): Promise<string> {
    const trackDownloadApiPath =
      `/api/v2.1/handlers/track/${trackId}:${albumId}/` +
      'web-album-track-track-main/download/m?' +
      `hq=1&external-domain=${this.getHostname()}&` +
      `overembed=no&__t=${Date.now()}`;

    const trackDownloadInfo = await this.getObject<TrackDownloadInfo>(
      this.getHostname(),
      trackDownloadApiPath
    );

    const fileDownloadInfoUrl = new URL(`https:${trackDownloadInfo.src}`);

    const fileDownloadInfo = await this.getObject<FileDownloadInfo>(
      fileDownloadInfoUrl.hostname,
      `${fileDownloadInfoUrl.href}&format=json`
    );

    const hasht = md5(
      'XGRlBW9FXlekgbPrRHuSiA' +
        fileDownloadInfo.path.substring(1) +
        fileDownloadInfo.s
    );
    const path =
      `/get-mp3/${hasht}/${fileDownloadInfo.ts}` +
      `${fileDownloadInfo.path}?track-id=${trackId}`;

    return fileDownloadInfo.host + path;
  }
  /**
   * Downloads track from yandex storage
   * @reutrn buffer representation of track
   */
  async downloadTrack(
    trackId: number,
    albumId: number,
    partialCallback?: DownloadPartialCallback
  ): Promise<Buffer> {
    const url = new URL(
      'https://' + (await this.getTrackDownloadLink(trackId, albumId))
    );
    return await this.getBuffer(url.host, url.href, partialCallback);
  }
  /**
   * Downloads cover with provided size from yandex storage
   * Not all cover sizes exist. Most common is 100,200,400
   * @return buffer representation of image
   */
  async downloadCover(
    coverUri: string,
    size: number,
    partialCallback?: DownloadPartialCallback
  ): Promise<Buffer> {
    const url = new URL('https://' + coverUri.replace('%%', `${size}x${size}`));
    return await this.getBuffer(url.host, url.href, partialCallback);
  }
}
