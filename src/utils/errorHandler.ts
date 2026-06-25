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

export const getHlsError = (data: any): ErrorState | null => {
  if (data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR) {
    return { 
      title: "Incompatible Stream", 
      desc: "This stream format cannot be read natively. Try opening it in an external player.", 
      raw: data.details 
    };
  }

  if (data.fatal) {
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      const httpStatus = data.response?.code || 0;
      let title = "Network Error";
      let desc = "Failed to download stream data.";
      
      if (httpStatus === 521 || httpStatus === 522) {
        title = "Proxy Blocked by Provider";
        desc = "This provider actively blocks Cloudflare Proxies. You MUST click 'Play External (without Proxy)' to watch this stream.";
      } else if (httpStatus === 403 || httpStatus === 401) {
        title = "Geo-Blocked / 403 Forbidden";
        desc = "The provider is actively blocking your connection. Try using the proxy to bypass this.";
      } else if (httpStatus === 0) {
        title = "CORS Block / Dead Link";
        desc = "The browser blocked this stream (CORS), or the server is completely unreachable.";
      } else if (httpStatus >= 500) {
        title = "Provider Offline";
        desc = "The IPTV server is experiencing downtime.";
      }

      return { title, desc, raw: `HTTP ${httpStatus} - ${data.details}` };
    }
    else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      return { 
        title: "Codec Unsupported", 
        desc: "This stream uses an incompatible video/audio codec for this browser.", 
        raw: `Media Error: ${data.details}` 
      };
    }
    else {
      return { 
        title: "Playback Error", 
        desc: "The stream data is corrupted or unreadable.", 
        raw: `System Error: ${data.details}` 
      };
    }
  }
  return null;
};