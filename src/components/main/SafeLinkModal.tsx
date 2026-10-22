import { memo, useMemo, useState } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import convertPunycode from '../../lib/punycode';
import { selectSharedSettings } from '../../global/selectors/sharedState';
import {
  ensureProtocol, getSuspiciousDomainCharacters, hasSuspiciousUrlCredentials, isSuspiciousUrl,
} from '../../util/browser/url';
import buildClassName from '../../util/buildClassName';
import { fetchDomainRegistrationDate, getLinkXray } from '../../util/linkXray';
import renderText from '../common/helpers/renderText';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Icon from '../common/icons/Icon';
import { LinkXrayDomain, LinkXrayShield } from '../common/LinkXrayCard';
import Button from '../ui/Button';
import Modal, {
  ModalFooterActions,
  ModalHeader,
  ModalTitle,
} from '@gili/modal/Modal';

import styles from './SafeLinkModal.module.scss';

export type OwnProps = {
  modal: string;
  isOpen: boolean;
};

type StateProps = {
  shouldCheckLinkDomainAge?: boolean;
};

type DomainAgeState = 'idle' | 'loading' | 'failed' | number;

const URL_PARTS_PATTERN = /^([a-z][a-z\d+.-]*:\/\/)([^/?#]*@)?(\[[^\]]+\]|[^:/?#]+)(.*)$/i;
const INVISIBLE_CHARACTER_PATTERN = /[\p{Default_Ignorable_Code_Point}\p{Cc}]/gu;
const DAY = 24 * 60 * 60 * 1000;
const NEW_DOMAIN_DAYS = 90;
const DAYS_PER_YEAR = 365;

const SafeLinkModal = ({ modal, isOpen, shouldCheckLinkDomainAge }: OwnProps & StateProps) => {
  const { toggleSafeLinkModal } = getActions();

  const lang = useLang();
  const renderedUrl = useMemo(() => renderUrl(modal), [modal]);
  const isSuspicious = useMemo(() => isSuspiciousUrl(modal), [modal]);
  const xray = useMemo(() => (modal ? getLinkXray(modal) : undefined), [modal]);
  const [domainAge, setDomainAge] = useState<DomainAgeState>('idle');
  const [checkedDomain, setCheckedDomain] = useState<string | undefined>();
  const currentDomainAge = checkedDomain === xray?.ownerDomainAscii ? domainAge : 'idle';

  const handleCheckDomainAge = useLastCallback(async () => {
    if (!xray) return;
    const domain = xray.ownerDomainAscii;
    setCheckedDomain(domain);
    setDomainAge('loading');
    const date = await fetchDomainRegistrationDate(domain);
    setDomainAge(date ?? 'failed');
  });

  const handleOpenOfficial = useLastCallback(() => {
    if (!xray) return;
    window.open(`https://${xray.target}`, '_blank', 'noopener noreferrer');
    toggleSafeLinkModal({ url: undefined });
  });

  const handleOpen = useLastCallback(() => {
    window.open(ensureProtocol(modal), '_blank', 'noopener noreferrer');
    toggleSafeLinkModal({ url: undefined });
  });

  const handleDismiss = useLastCallback(() => {
    toggleSafeLinkModal({ url: undefined });
  });

  const header = useMemo(() => (
    <ModalHeader>
      <ModalTitle>{lang(xray ? 'LinkXrayTitle' : 'OpenUrlTitle')}</ModalTitle>
    </ModalHeader>
  ), [lang, xray]);

  function renderDomainAge() {
    if (!xray || xray.isFreeHosting || !shouldCheckLinkDomainAge) return undefined;

    if (currentDomainAge === 'idle' || currentDomainAge === 'loading') {
      return (
        <div className={styles.age}>
          <Button
            size="smaller"
            color="translucent"
            noForcedUpperCase
            isLoading={currentDomainAge === 'loading'}
            onClick={handleCheckDomainAge}
          >
            {lang('LinkXrayCheckAge')}
          </Button>
          <p className={styles.ageHint}>{lang('LinkXrayAgeHint')}</p>
        </div>
      );
    }

    if (currentDomainAge === 'failed') {
      return <p className={styles.ageResult}>{lang('LinkXrayAgeFailed')}</p>;
    }

    const days = Math.max(0, Math.floor((Date.now() - currentDomainAge) / DAY));
    const isNew = days < NEW_DOMAIN_DAYS;
    return (
      <p className={buildClassName(styles.ageResult, isNew && styles.ageNew)}>
        {days < DAYS_PER_YEAR
          ? lang('LinkXrayAgeDays', { count: days }, { pluralValue: days })
          : lang('LinkXrayAgeYear', { year: new Date(currentDomainAge).getFullYear() })}
      </p>
    );
  }

  if (xray) {
    return (
      <Modal
        isOpen={isOpen}
        header={header}
        width="slim"
        height="auto"
        ariaLabel={lang('LinkXrayTitle')}
        onClose={handleDismiss}
      >
        <div className={styles.xray}>
          <LinkXrayShield className={styles.xrayShield} />
          <LinkXrayDomain xray={xray} className={styles.xrayDomain} />
        </div>
        <p className={styles.xrayText}>
          {renderText(lang('LinkXrayLooksLike', { site: xray.target }, { withNodes: true, withMarkdown: true }))}
        </p>
        <p className={styles.xrayReason}>
          {lang(REASON_KEYS[xray.reason], { site: xray.target, host: xray.ownerDomain })}
        </p>
        {isSuspicious && (
          <p className={styles.xrayReason}>{lang('OpenUrlWarning')}</p>
        )}
        {renderDomainAge()}
        <p className={buildClassName(styles.url, styles.xrayUrl)} dir="ltr">{renderedUrl}</p>
        <Button size="smaller" fluid noForcedUpperCase className={styles.official} onClick={handleOpenOfficial}>
          {lang('LinkXrayGoToReal', { site: xray.target })}
        </Button>
        <ModalFooterActions>
          <Button isText size="smaller" color="danger" fluid onClick={handleOpen}>
            {lang('LinkXrayOpenAnyway')}
          </Button>
          <Button isText size="smaller" color="primary" fluid autoFocus onClick={handleDismiss}>
            {lang('Cancel')}
          </Button>
        </ModalFooterActions>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      header={header}
      width="slim"
      height="auto"
      ariaLabel={lang('OpenUrlTitle')}
      onClose={handleDismiss}
    >
      {renderText(lang('OpenUrlText', {
        url: <span className={styles.url} dir="ltr">{renderedUrl}</span>,
      }, { withNodes: true, withMarkdown: true }))}
      {isSuspicious && (
        <p className={styles.warning}>
          <Icon className={buildClassName(styles.riskIcon, 'in-text-icon')} name="info-filled" />
          {lang('OpenUrlWarning')}
        </p>
      )}
      <ModalFooterActions>
        <Button isText size="smaller" color="primary" fluid onClick={handleDismiss}>
          {lang('Cancel')}
        </Button>
        <Button isText size="smaller" color="primary" fluid autoFocus onClick={handleOpen}>
          {lang('OpenUrlConfirm')}
        </Button>
      </ModalFooterActions>
    </Modal>
  );
};

const REASON_KEYS = {
  lookalike: 'LinkXrayReasonLookalike',
  otherEnding: 'LinkXrayReasonOtherEnding',
  freeHosting: 'LinkXrayReasonFreeHosting',
  brandMention: 'LinkXrayReasonBrandMention',
} as const;

export default memo(withGlobal<OwnProps>(
  (global): Complete<StateProps> => ({
    shouldCheckLinkDomainAge: selectSharedSettings(global).shouldCheckLinkDomainAge,
  }),
)(SafeLinkModal));

function renderUrl(url: string) {
  try {
    // Split the serialized URL so highlighting follows the browser's actual destination
    const parsedUrl = new URL(ensureProtocol(url));
    const parts = parsedUrl.href.match(URL_PARTS_PATTERN);
    if (!parts) return formatUrlPart(parsedUrl.href);

    const [, protocol, credentials, hostname, suffix] = parts;
    const domain = convertPunycode(hostname);

    return (
      <>
        {protocol}
        {credentials && (
          <>
            <span className={hasSuspiciousUrlCredentials(parsedUrl) ? styles.suspicious : undefined}>
              {formatUrlPart(credentials.slice(0, -1))}
            </span>
            @
          </>
        )}
        <span className={styles.domain}>
          {domain.split('.').map((label, index) => (
            <>
              {index > 0 && '.'}
              {renderDomainLabel(label)}
            </>
          ))}
        </span>
        {formatUrlPart(suffix)}
      </>
    );
  } catch (err) {
    return <span className={styles.suspicious}>{formatUrlPart(url)}</span>;
  }
}

function renderDomainLabel(label: string) {
  const suspiciousCharacters = getSuspiciousDomainCharacters(label);
  if (!suspiciousCharacters.size) return formatUrlPart(label);

  return Array.from(label, (character) => (
    suspiciousCharacters.has(character)
      ? <span className={styles.suspicious}>{formatUrlPart(character)}</span>
      : character
  ));
}

function formatUrlPart(part: string) {
  let decodedPart = part;
  try {
    decodedPart = decodeURI(part);
  } catch (err) {
    // Malformed escape sequences remain visible
  }

  // Keep invisible and direction-changing characters visible instead of letting them disguise the URL
  return decodedPart.replace(INVISIBLE_CHARACTER_PATTERN, encodeURIComponent);
}
