import { memo, useMemo } from '../../lib/teact/teact';

import type { LinkXray } from '../../util/linkXray';

import buildClassName from '../../util/buildClassName';
import renderText from './helpers/renderText';

import useLang from '../../hooks/useLang';

import Portal from '../ui/Portal';

import styles from './LinkXrayCard.module.scss';

type OwnProps = {
  xray: LinkXray;
  anchorRect: DOMRect;
};

const CARD_WIDTH = 280;
const CARD_OFFSET = 6;
const SCREEN_MARGIN = 8;
const MIN_SPACE_BELOW = 140;

export const LinkXrayShield = ({ className }: { className?: string }) => (
  <svg className={buildClassName(styles.shield, className)} viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M8 1.2 2.6 3.3v4.1c0 3.3 2.3 6.2 5.4 7.4 3.1-1.2 5.4-4.1 5.4-7.4V3.3L8 1.2Z"
      fill="currentColor"
    />
    <path d="M8 4.6v4" stroke="var(--color-background)" stroke-width="1.6" stroke-linecap="round" />
    <circle cx="8" cy="10.9" r="0.95" fill="var(--color-background)" />
  </svg>
);

export const LinkXrayDomain = ({ xray, className }: { xray: LinkXray; className?: string }) => {
  const parts = useMemo(() => {
    const result: { text: string; isMarked: boolean }[] = [];
    Array.from(xray.host).forEach((character, index) => {
      const isMarked = Boolean(xray.markedCharacters[index]);
      const last = result[result.length - 1];
      if (last && last.isMarked === isMarked) {
        last.text += character;
      } else {
        result.push({ text: character, isMarked });
      }
    });
    return result;
  }, [xray]);

  return (
    <span className={buildClassName(styles.domain, className)} dir="ltr">
      {parts.map(({ text, isMarked }) => (isMarked ? <mark className={styles.mark}>{text}</mark> : text))}
    </span>
  );
};

const LinkXrayHoverCard = ({ xray, anchorRect }: OwnProps) => {
  const lang = useLang();

  const style = useMemo(() => {
    const left = Math.max(SCREEN_MARGIN, Math.min(anchorRect.left, window.innerWidth - CARD_WIDTH - SCREEN_MARGIN));
    const hasSpaceBelow = window.innerHeight - anchorRect.bottom > MIN_SPACE_BELOW;
    const vertical = hasSpaceBelow
      ? `top: ${anchorRect.bottom + CARD_OFFSET}px`
      : `bottom: ${window.innerHeight - anchorRect.top + CARD_OFFSET}px`;
    return `left: ${left}px; ${vertical}; width: ${CARD_WIDTH}px`;
  }, [anchorRect]);

  return (
    <Portal>
      <div className={styles.card} style={style} role="tooltip">
        <div className={styles.header}>
          <LinkXrayShield />
          {lang('LinkXrayShieldLabel')}
        </div>
        <LinkXrayDomain xray={xray} className={styles.cardDomain} />
        <p className={styles.text}>
          {renderText(lang('LinkXrayLooksLike', { site: xray.target }, { withNodes: true, withMarkdown: true }))}
        </p>
        <p className={styles.hint}>{lang('LinkXrayHoverHint')}</p>
      </div>
    </Portal>
  );
};

export default memo(LinkXrayHoverCard);
