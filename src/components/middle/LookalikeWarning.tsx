import {
  memo, useEffect, useMemo, useRef, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiChat, ApiChatFullInfo, ApiUser } from '../../api/types';
import type { LookalikeCandidate, LookalikeReason } from '../../util/lookalike';
import { ApiMediaFormat } from '../../api/types';

import { getChatAvatarHash, getChatTitle, getMainUsername, getUserFullName } from '../../global/helpers';
import { selectUser } from '../../global/selectors';
import buildClassName from '../../util/buildClassName';
import { formatRegistrationMonth } from '../../util/localization/dateFormat';
import { findLookalike, getAvatarHash, getLookalikeDiff } from '../../util/lookalike';
import * as mediaLoader from '../../util/mediaLoader';
import renderText from '../common/helpers/renderText';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Avatar from '../common/Avatar';
import Icon from '../common/icons/Icon';
import Button from '../ui/Button';

import styles from './LookalikeWarning.module.scss';

type OwnProps = {
  userId: string;
  commonChatIds?: string[];
  registrationMonth?: string;
  withTopMargin?: boolean;
};

type StateProps = {
  sender?: ApiUser;
  usersById: Record<string, ApiUser>;
  chatsById: Record<string, ApiChat>;
  chatsFullInfoById: Record<string, ApiChatFullInfo>;
};

type AdminCandidate = LookalikeCandidate & { chatId: string };

// Admins of these many shared groups are checked, which covers the usual case without loading every group
const MAX_CHECKED_CHATS = 10;
const MAX_CHECKED_ADMINS = 50;
const DISMISSED_STORAGE_KEY = 'tt-lookalike-dismissed';

const REASON_KEYS = {
  sameName: 'LookalikeReasonSameName',
  similarName: 'LookalikeReasonSimilarName',
  similarUsername: 'LookalikeReasonSimilarUsername',
  samePhoto: 'LookalikeReasonSamePhoto',
} as const satisfies Record<LookalikeReason, string>;

const requestedChatIds = new Set<string>();
const avatarHashCache = new Map<string, string | undefined>();

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch {
    return [];
  }
}

function writeDismissed(keys: string[]) {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Storage may be unavailable in private mode; the warning just shows again next time
  }
}

const LookalikeWarning = ({
  userId,
  commonChatIds,
  registrationMonth,
  withTopMargin,
  sender,
  usersById,
  chatsById,
  chatsFullInfoById,
}: OwnProps & StateProps) => {
  const {
    loadFullChat, blockUser, reportSpam, openChat, deleteHistory,
  } = getActions();
  const lang = useLang();

  const [avatarHashes, setAvatarHashes] = useState<Record<string, string | undefined>>({});
  const [isDismissed, setIsDismissed] = useState(() => readDismissed().some((key) => key.startsWith(`${userId}:`)));
  const isMountedRef = useRef(true);

  const checkedChatIds = useMemo(() => commonChatIds?.slice(0, MAX_CHECKED_CHATS), [commonChatIds]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // The admin list of a shared group comes with its full info
  useEffect(() => {
    checkedChatIds?.forEach((chatId) => {
      if (chatsFullInfoById[chatId]?.adminMembersById || requestedChatIds.has(chatId)) return;
      requestedChatIds.add(chatId);
      loadFullChat({ chatId, force: true });
    });
  }, [checkedChatIds, chatsFullInfoById]);

  const candidates = useMemo(() => {
    const result: AdminCandidate[] = [];
    const seenIds = new Set<string>();

    checkedChatIds?.forEach((chatId) => {
      const adminIds = Object.keys(chatsFullInfoById[chatId]?.adminMembersById || {});
      adminIds.forEach((adminId) => {
        const admin = usersById[adminId];
        if (!admin || adminId === userId || seenIds.has(adminId) || result.length >= MAX_CHECKED_ADMINS) return;
        seenIds.add(adminId);
        result.push({
          id: adminId,
          chatId,
          name: getUserFullName(lang, admin) || '',
          username: getMainUsername(admin),
          avatarHash: avatarHashes[adminId],
        });
      });
    });

    return result;
  }, [checkedChatIds, chatsFullInfoById, usersById, userId, lang, avatarHashes]);

  // Compare avatars on the device: a copied photo keeps nearly the same hash
  useEffect(() => {
    const users = [sender, ...candidates.map(({ id }) => usersById[id])];
    users.forEach((user) => {
      if (!user?.avatarPhotoId) return;
      const mediaHash = getChatAvatarHash(user);
      if (!mediaHash) return;

      if (avatarHashCache.has(mediaHash)) {
        const cached = avatarHashCache.get(mediaHash);
        if (avatarHashes[user.id] !== cached) {
          setAvatarHashes((current) => ({ ...current, [user.id]: cached }));
        }
        return;
      }

      avatarHashCache.set(mediaHash, undefined);
      void (async () => {
        try {
          const url = await mediaLoader.fetch(mediaHash, ApiMediaFormat.BlobUrl) as string | undefined;
          const hash = url ? await getAvatarHash(url) : undefined;
          avatarHashCache.set(mediaHash, hash);
          if (hash && isMountedRef.current) {
            setAvatarHashes((current) => ({ ...current, [user.id]: hash }));
          }
        } catch {
          // A missing avatar only means one signal less
        }
      })();
    });
  }, [sender, candidates, usersById, avatarHashes]);

  const match = useMemo(() => {
    if (!sender || !candidates.length) return undefined;

    return findLookalike({
      id: sender.id,
      name: getUserFullName(lang, sender) || '',
      username: getMainUsername(sender),
      avatarHash: avatarHashes[sender.id],
    }, candidates);
  }, [sender, candidates, lang, avatarHashes]);

  const admin = match ? usersById[match.candidateId] : undefined;
  const adminCandidate = match ? candidates.find(({ id }) => id === match.candidateId) : undefined;
  const group = adminCandidate ? chatsById[adminCandidate.chatId] : undefined;

  const handleBlockAndReport = useLastCallback(() => {
    reportSpam({ chatId: userId });
    blockUser({ userId });
    deleteHistory({ chatId: userId, shouldDeleteForAll: false });
  });

  const handleOpenAdmin = useLastCallback(() => {
    if (!admin) return;
    openChat({ id: admin.id });
  });

  const handleDismiss = useLastCallback(() => {
    if (!admin) return;
    writeDismissed([...readDismissed(), `${userId}:${admin.id}`]);
    setIsDismissed(true);
  });

  if (!match || !sender || !admin || isDismissed) return undefined;

  const senderName = getUserFullName(lang, sender) || '';
  const adminName = getUserFullName(lang, admin) || '';
  const senderUsername = getMainUsername(sender);
  const adminUsername = getMainUsername(admin);
  const groupTitle = group ? getChatTitle(lang, group) : '';

  function renderDiff(text: string, original?: string) {
    if (!original) return renderText(text);

    return getLookalikeDiff(text, original).map(({ char, isDifferent }, index) => (
      isDifferent
        ? <mark key={index} className={styles.diff}>{char}</mark>
        : char
    ));
  }

  return (
    <div className={buildClassName(styles.root, withTopMargin && styles.withTopMargin)} role="alert">
      <div className={styles.header}>
        <Icon name="warning-filled" className={styles.headerIcon} />
        <h3 className={styles.title}>{lang('LookalikeTitle')}</h3>
      </div>
      <p className={styles.subtitle}>
        {lang('LookalikeSubtitle', { admin: adminName, group: groupTitle }, { withNodes: true, withMarkdown: true })}
      </p>

      <div className={styles.compare}>
        <div className={styles.profile}>
          <span className={styles.label}>{lang('LookalikeRealLabel', { group: groupTitle })}</span>
          <Avatar peer={admin} size="medium" />
          <span className={styles.name}>{renderText(adminName)}</span>
          {adminUsername && (
            <span className={styles.username}>
              @
              {adminUsername}
            </span>
          )}
          <span className={styles.badge}>
            <Icon name="admin" />
            {lang('LookalikeAdminBadge')}
          </span>
        </div>
        <div className={styles.vs} aria-hidden>≠</div>
        <div className={buildClassName(styles.profile, styles.suspect)}>
          <span className={styles.label}>{lang('LookalikeSuspectLabel')}</span>
          <Avatar peer={sender} size="medium" />
          <span className={styles.name}>{renderDiff(senderName, adminName)}</span>
          {senderUsername && (
            <span className={styles.username}>
              @
              {renderDiff(senderUsername, adminUsername)}
            </span>
          )}
          {registrationMonth && (
            <span className={buildClassName(styles.badge, styles.badgeDanger)}>
              {lang('LookalikeRegistered', { date: formatRegistrationMonth(lang, registrationMonth) })}
            </span>
          )}
        </div>
      </div>

      <ul className={styles.reasons}>
        {match.reasons.map((reason) => (
          <li key={reason}>
            <Icon name="close-circle" className={styles.reasonIcon} />
            {lang(REASON_KEYS[reason])}
          </li>
        ))}
      </ul>

      <div className={styles.actions}>
        <Button color="danger" size="smaller" onClick={handleBlockAndReport}>
          {lang('LookalikeBlockAndReport')}
        </Button>
        <Button isText size="smaller" onClick={handleOpenAdmin}>
          {lang('LookalikeOpenAdmin')}
        </Button>
        <Button isText size="smaller" color="gray" onClick={handleDismiss}>
          {lang('LookalikeDismiss')}
        </Button>
      </div>
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { userId }): Complete<StateProps> => {
    return {
      sender: selectUser(global, userId),
      usersById: global.users.byId,
      chatsById: global.chats.byId,
      chatsFullInfoById: global.chats.fullInfoById,
    };
  },
)(LookalikeWarning));
