// 1. Web Directory API (Hardcoded, public microservice)
export const DIRECTORY_API = "https://directory-hub.ashishsri2018.workers.dev/api";

// 2. IPTV & Proxy APIs (The Monolith)
// Local testing uses the full URL, production uses ""
export const API_URL = import.meta.env.DEV 
  ? "https://iptv-hub.ashishsri2018.workers.dev" 
  : "";
