import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import fs from 'fs';
import fetch from 'node-fetch';
import { OutputAsset, OutputChunk } from 'rollup';
import { Plugin } from 'vite';

export interface PluginOptions {
  /**
   * A list of strings you can provide that the plugin will use to match html tags with.
   * It will then try to compute an integrity attribute for the matched tag.
   * Currently it only matches script tags and link with rel=stylesheet as per specification.
   * see [the W3C spec](https://www.w3.org/TR/SRI/#elements) for more information.
   * The selector syntax is the same as jQuery's.
   * @default ["script","link[rel=stylesheet]"]
   */
  selectors?: string[];

  /**
   * A list of hashing algorithms to use when computing the integrity attribute.
   * The hashing algorithm has to be supported by the nodejs version you're running on and by the Browser
   * you're targeting.
   * Browsers will ignore unknown hashing functions.
   * Standard hash functions as defined in the
   * [subresource integrity specification](https://w3c.github.io/webappsec-subresource-integrity/#hash-functions)
   * are: `sha256`, `sha384` and `sha512`.
   *
   * > NOTE: While browser vendors are free to support more algorithms than those stated above,
   * > they generally do not accept `sha1` and `md5` hashes.
   * @default ["sha384"]
   */
  algorithms?: 'sha256'[] | 'sha384'[] | 'sha512'[] | string[];

  /**
   * Specifies the value for the crossorigin attribute.
   * This attribute has to be set on the generated html tags to prevent cross-origin data leakage.
   * The default value `anonymous` should be okay for normal use.
   * see: [the W3C spec](https://www.w3.org/TR/SRI/#cross-origin-data-leakage) for details.
   * @default "anonymous"
   */
  crossorigin?: 'anonymous' | 'use-credentials';

  /**
   * Can be used to disable the plugin, as subresource integrities might cause issues with hot module reloading.
   * @default true
   */
  active?: boolean;

  /**
   * Commonly assets will be prefixed with a public path, such as "/" or "/assets".
   * Setting this option to the public path allows plugin-sri to resolve those imports.
   * @default ""
   */
  publicPath?: string;
}

const invalidHashAlgorithms = ['sha1', 'md5'];

export default function subresourceIntegrity(options?: PluginOptions): Plugin {
  const selectors = options?.selectors || ['script', 'link[rel=stylesheet]'];
  const hashAlgorithms = options?.algorithms || ['sha384'];
  const crossorigin = options?.crossorigin || 'anonymous';
  const publicPath = options?.publicPath ?? '';
  let active = options?.active ?? true;

  return {
    name: 'subresource-integrity',
    buildStart() {
      hashAlgorithms
        .filter((alg) => invalidHashAlgorithms.includes(alg.toLowerCase()))
        .forEach((alg) => this.warn(`Insecure hashing algorithm "${alg}" will be rejected by browsers!`));
    },
    async closeBundle() {
      if (!active) return;

      const buildDir = 'build';
      let content = fs.readFileSync(buildDir + '/index.html');

      const $ = cheerio.load(content);
      const elements = $(selectors.join()).get();

      for (const el of elements) {
        const url = ($(el).attr('href') || $(el).attr('src'))?.replace(publicPath, '');
        if (!url) continue;

        let buf: Buffer;
        if (fs.existsSync(buildDir + '/' + url)) {
          //@ts-ignore
          buf = Buffer.from(fs.readFileSync(buildDir + '/' + url));
        } else if (url.startsWith('http')) {
          buf = await (await fetch(url)).buffer();
        } else {
          this.warn(`could not resolve resource "${url}"!`);
          continue;
        }

        const hashes = hashAlgorithms.map((algorithm) => generateIdentity(buf, algorithm));

        $(el).attr('integrity', hashes.join(' '));
        $(el).attr('crossorigin', crossorigin);
      }

      fs.writeFileSync(build + '/index.html', $.html());
    },
  };
}

function generateIdentity(source: Buffer, alg: string) {
  const hash = createHash(alg).update(source).digest().toString('base64');
  return `${alg.toLowerCase()}-${hash}`;
}

function isHtmlAsset(obj: OutputAsset | OutputChunk): obj is OutputAsset {
  return obj.fileName.endsWith('.html') && obj.type === 'asset';
}