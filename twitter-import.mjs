// Public embed metadata only; no account, cookies, or API credentials.
function parseTwitterMediaUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol === 'https:' &&
      url.hostname === 'video.twimg.com' &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/(?:tweet_video|ext_tw_video|amplify_video)\/.+\.mp4$/i.test(url.pathname)
    ) {
      url.hash = '';
      return url;
    }
  } catch {}
  return null;
}

export function selectTwitterMedia(tweet, index = '') {
  const media = Array.isArray(tweet?.mediaDetails) ? tweet.mediaDetails : [],
    selected = index
      ? media[Number(index) - 1]
      : media.find((item) => item?.type === 'animated_gif') ||
        media.find((item) => item?.type === 'video');
  let variants = selected?.video_info?.variants;
  // Some embeds expose only the older top-level video object.
  if (!index && !media.length) variants = tweet?.video?.variants;
  let best = null;
  for (const variant of Array.isArray(variants) ? variants : []) {
    if ((variant?.content_type || variant?.type) !== 'video/mp4') continue;
    const url = parseTwitterMediaUrl(variant.url || variant.src);
    if (!url) continue;
    const dimensions = url.pathname.match(/\/(\d+)x(\d+)\//),
      bitrate = Number(variant.bitrate || variant.bit_rate) || 0,
      area = dimensions ? Number(dimensions[1]) * Number(dimensions[2]) : 0;
    if (!best || bitrate > best.bitrate || (bitrate === best.bitrate && area > best.area)) {
      best = { url: url.href, bitrate, area };
    }
  }
  if (!best) {
    throw new Error(
      'No downloadable GIF or MP4 was found in that post. It may be private, deleted, restricted, or unavailable in public embeds. Try a direct video.twimg.com MP4 link or a saved file.',
    );
  }
  return best.url;
}

export async function resolveTwitterMedia(id, index = '', { fetchImpl = fetch, signal } = {}) {
  if (!/^[1-9]\d{0,19}$/.test(id) || (index && !/^[1-9]\d?$/.test(index))) {
    throw new Error('Invalid Twitter/X post or media number.');
  }
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ''),
    url = new URL('https://cdn.syndication.twimg.com/tweet-result');
  url.search = new URLSearchParams({ id, lang: 'en', token }).toString();
  const response = await fetchImpl(url.href, {
    signal,
    // Workers support manual redirects; non-2xx responses below are rejected.
    redirect: 'manual',
    credentials: 'omit',
    // Twitter rejects requests without a User-Agent; Workers do not add one.
    headers: {
      Accept: 'application/json',
      'User-Agent': 'EmoteWorkshop (+https://emotes.gimba.uk)',
    },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Twitter/X returned ${response.status}. Try a public post or a direct MP4 link.`,
    );
  }
  const limit = 2 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('Twitter/X returned too much post data.');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > limit) throw new Error('Twitter/X returned too much post data.');
    chunks.push(chunk);
  }
  let tweet;
  try {
    tweet = JSON.parse(await new Blob(chunks).text());
  } catch {
    throw new Error('Twitter/X did not return readable post data. Try a direct MP4 link.');
  }
  return { mediaUrl: selectTwitterMedia(tweet, index) };
}
