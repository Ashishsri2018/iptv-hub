import Hls from 'hls.js';

export interface ErrorState {
  title: string;
  desc: string;
  raw: string;
}

export const getNativeError = (errorCode: number | undefined): ErrorState => {
  let rawCode = "Unknown";
  switch(errorCode) {
    case 1: rawCode = "MEDIA_ERR_ABORTED"; break;
    case 2: rawCode = "MEDIA_ERR_NETWORK"; break;
    case 3: rawCode = "MEDIA_ERR_DECODE"; break;
    case 4: rawCode = "MEDIA_ERR_SRC_NOT_SUPPORTED"; break;
  }
  return {
    title: "Native Playback Failed",
    desc: "The browser's native video engine rejected this stream format. Use the proxy or external player.",
    raw: `Code: ${rawCode}`
  };
};

export const getHlsError = (data: any, isProxyActive: boolean = false): ErrorState | null => {
  if (data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR) {
    return { 
      title: "Incompatible Stream", 
      desc: "This stream format cannot be read natively. Try opening it in an external player.", 
      raw: data.details 
    };
  }

  if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
    const httpStatus = data.response?.code || 0;
    let title = "Network Error";
    let desc = "Failed to download stream data.";

    // Pinpoint exactly what failed
    if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
      title = "Playlist Load Error";
      desc = "Could not load the main stream file.";
    } else if (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR) {
      title = "Fragment Load Error";
      desc = "Could not load video chunks or audio/subtitles.";
    }

    if (httpStatus === 0) {
      if (!navigator.onLine) {
        title = "No Internet Connection";
        desc = "Your device is offline or the network dropped.";
      } else {
        title = "CORS Block / Dead Link";
        desc = isProxyActive 
          ? "The proxy failed to fetch this chunk. The provider might be actively blocking Cloudflare servers."
          : "The browser blocked this stream (CORS). You MUST click 'Retry with Proxy' to tunnel it.";
      }
    } else if (httpStatus === 521 || httpStatus === 522) {
      title = "Proxy Blocked by Provider";
      desc = "This provider actively blocks Cloudflare Proxies. You MUST click 'Play External (without Proxy)'.";
    } else if (httpStatus === 403 || httpStatus === 401) {
      title = "Geo-Blocked / 403 Forbidden";
      desc = "The provider is actively blocking your connection. Try using the proxy.";
    } else if (httpStatus >= 500) {
      title = "Provider Offline";
      desc = "The IPTV server is experiencing downtime.";
    }

    return { title, desc, raw: `HTTP ${httpStatus} - ${data.details}` };
  }

  if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
    return { 
      title: "Codec Unsupported", 
      desc: "This stream uses an incompatible video/audio codec for this browser.", 
      raw: `Media Error: ${data.details}` 
    };
  }

  if (data.fatal) {
    return { 
      title: "Fatal Playback Error", 
      desc: "The stream crashed unexpectedly.", 
      raw: `System Error: ${data.details}` 
    };
  }

  return null;
};
