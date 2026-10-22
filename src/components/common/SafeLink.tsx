import type { TeactNode } from '../../lib/teact/teact';
import { useEffect, useRef, useState } from '../../lib/teact/teact';
import { getActions } from '../../global';

import type { ThreadId } from '../../types';
import { ApiMessageEntityTypes, type LinkContext } from '../../api/types';

import { IS_TAURI } from '../../util/browser/globalEnvironment';
import { ensureProtocol, getUnicodeUrl, isSuspiciousUrl } from '../../util/browser/url';
import { MouseButton } from '../../util/browser/windowEnvironment';
import buildClassName from '../../util/buildClassName';
import { getLinkXray } from '../../util/linkXray';

import useLastCallback from '../../hooks/useLastCallback';

import LinkXrayHoverCard, { LinkXrayShield } from './LinkXrayCard';

type OwnProps = {
  url?: string;
  text: string;
  className?: string;
  children?: TeactNode;
  isRtl?: boolean;
  shouldSkipModal?: boolean;
  tryInstantView?: boolean;
  previewId?: string;
  chatId?: string;
  messageId?: number;
  threadId?: ThreadId;
  entityType?: ApiMessageEntityTypes.Url | ApiMessageEntityTypes.TextUrl |
    `${ApiMessageEntityTypes.TextUrl}` | `${ApiMessageEntityTypes.Url}`;
};

const HOVER_CARD_SHOW_DELAY = 250;

const SafeLink = ({
  url,
  text,
  className,
  children,
  isRtl,
  shouldSkipModal,
  tryInstantView,
  previewId,
  chatId,
  messageId,
  threadId,
  entityType = ApiMessageEntityTypes.Url,
}: OwnProps) => {
  const { openUrl } = getActions();

  const content = children || text;
  const isRegularLink = url === text;
  // Only links inside messages get the shield, other places still get the warning on click
  const xray = url && chatId && messageId ? getLinkXray(url) : undefined;

  const [hoverRect, setHoverRect] = useState<DOMRect | undefined>();
  const hoverTimeoutRef = useRef<number>();

  useEffect(() => () => window.clearTimeout(hoverTimeoutRef.current), []);

  const handleMouseEnter = useLastCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = e.currentTarget;
    window.clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoverRect(target.getBoundingClientRect());
    }, HOVER_CARD_SHOW_DELAY);
  });

  const handleMouseLeave = useLastCallback(() => {
    window.clearTimeout(hoverTimeoutRef.current);
    setHoverRect(undefined);
  });

  const handleClick = useLastCallback((e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
    if (!url) return true;
    if (e.button !== MouseButton.Main && e.button !== MouseButton.Auxiliary) return true;

    e.preventDefault();

    const shouldOpenInNewTab = e.button === MouseButton.Auxiliary || e.ctrlKey || e.metaKey || e.shiftKey;
    setHoverRect(undefined);
    const isTrustedLink = isRegularLink && !isSuspiciousUrl(url) && !getLinkXray(url);
    const linkContext: LinkContext | undefined = chatId && messageId
      ? { type: 'message', chatId, threadId, messageId }
      : undefined;
    openUrl({
      url,
      shouldSkipModal: shouldSkipModal || isTrustedLink,
      ignoreDeepLinks: shouldOpenInNewTab,
      tryInstant: shouldOpenInNewTab ? false : tryInstantView,
      previewId,
      linkContext,
    });

    return false;
  });

  if (!url) {
    return undefined;
  }

  const classNames = buildClassName(
    className || 'text-entity-link',
    isRegularLink && 'word-break-all',
    xray && 'link-xray-risky',
  );

  const link = (
    <a
      href={ensureProtocol(url)}
      title={xray ? undefined : getUnicodeUrl(url)}
      target={IS_TAURI ? '_self' : '_blank'}
      rel="noopener noreferrer"
      className={classNames}
      onClick={handleClick}
      onAuxClick={handleClick}
      dir={isRtl ? 'rtl' : 'auto'}
      data-entity-type={entityType}
      onMouseEnter={xray ? handleMouseEnter : undefined}
      onMouseLeave={xray ? handleMouseLeave : undefined}
    >
      {xray && <LinkXrayShield className="link-xray-shield" />}
      {content}
    </a>
  );

  if (!xray) return link;

  return (
    <>
      {link}
      {hoverRect && <LinkXrayHoverCard xray={xray} anchorRect={hoverRect} />}
    </>
  );
};

export default SafeLink;
