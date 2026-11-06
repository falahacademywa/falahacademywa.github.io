// <img>/<a> for stored photo links that may point at a private bucket (phase 39). Renders nothing
// until the signed link is ready; a link the viewer may not open simply does not show.
import type { AnchorHTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";
import { useSignedUrl } from "../lib/secureUrl";

export default function SecureImg({ src, ...rest }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string | null | undefined }) {
  const url = useSignedUrl(src);
  if (!url) return <span className={`inline-block bg-silver ${rest.className ?? ""}`} aria-hidden />;
  return <img src={url} {...rest} />;
}

export function SecureLink({ href, children, ...rest }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string | null | undefined; children: ReactNode }) {
  const url = useSignedUrl(href);
  return <a href={url ?? undefined} {...rest}>{children}</a>;
}
