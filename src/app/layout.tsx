import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", weight: ["400", "500", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "600"] });

export const metadata: Metadata = {
  title: "Tiger Cam · earlier formats",
  description: "Earlier formats of Tiger Cam: an AI agent in a real sandbox on a Vultr VM. The live cam is at the site's start page.",
};

export const viewport: Viewport = { themeColor: "#0c131f", width: "device-width", initialScale: 1, viewportFit: "cover" };

/**
 * Runs before the app, in plain old JavaScript, so it also runs on a phone whose browser is too old for
 * the app itself. It reports errors, and on a join page that never starts it says so on the screen and
 * tells the server, so a phone that cannot play is seen instead of silently stuck.
 */
const EARLY = `(function(){
var t0=Date.now();
function send(kind,detail){try{var b=JSON.stringify({kind:kind,detail:String(detail||"").slice(0,300),path:location.pathname,ua:navigator.userAgent,t:Date.now()-t0});
if(navigator.sendBeacon){navigator.sendBeacon("/api/client-log",b)}else{var x=new XMLHttpRequest();x.open("POST","/api/client-log");x.send(b)}}catch(e){}}
window.__wallLog=send;
window.addEventListener("error",function(e){send("error",(e.message||"")+" @"+(e.filename||"")+":"+(e.lineno||""))});
window.addEventListener("unhandledrejection",function(e){var r=e.reason;send("rejection",r&&(r.message||r))});
if(location.pathname.indexOf("/join/")===0){setTimeout(function(){if(!window.__wallReady){send("no-start","the app did not start");
var m=document.getElementById("wall-fallback");if(m){m.style.display="block"}}},8000)}
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: EARLY }} />
      </head>
      <body>
        {children}
        <div id="wall-fallback" className="fallback" style={{ display: "none" }}>
          <b>This phone&apos;s browser could not start the game.</b>
          <span>Update the phone, or open the link in Chrome. On an iPhone: Settings → General → Software Update.</span>
        </div>
      </body>
    </html>
  );
}
