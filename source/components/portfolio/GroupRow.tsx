'use client';

import { useState, type CSSProperties } from 'react';
import type { WalletGroup } from '@/lib/api/wallet-groups';
import { Folder, Settings, Trash } from '@/components/listen/icons/Icons';
import { WALLETS_GRID_TEMPLATE } from './tableLayout';

/**
 * Slice "Portfolio page wallets tab": collapsed-by-default group row.
 * Minimal-by-default to match Axiom's reference:
 *
 *   [folder icon][name][member count][hover-only edit/delete]
 *
 * Click the row body to expand/collapse the member list. Click the
 * folder icon to toggle selection of every member wallet. Edit and
 * delete icons are hover-only and right-aligned in the Actions column,
 * matching the wallet row.
 */

interface Props {
  readonly group: WalletGroup;
  readonly memberCount: number;
  readonly expanded: boolean;
  readonly onToggleExpand: () => void;
  readonly allMembersSelected: boolean;
  readonly someMembersSelected: boolean;
  readonly onToggleGroupSelect: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}

export function GroupRow(props: Props): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const folderColor = props.allMembersSelected
    ? 'var(--ink-0)'
    : props.someMembersSelected
      ? 'color-mix(in srgb, var(--ink-0) 70%, var(--ink-3))'
      : 'var(--ink-2)';

  return (
    <div
      role="row"
      data-testid={`group-row-${props.group.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={props.onToggleExpand}
      style={{
        ...rowStyle,
        background: hovered ? 'var(--chip-bg)' : 'transparent',
        boxShadow: props.expanded ? 'inset 2px 0 0 var(--ink-0)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onToggleGroupSelect();
          }}
          aria-pressed={props.allMembersSelected}
          aria-label={`Select all in ${props.group.name}`}
          title={props.allMembersSelected ? 'Unselect group' : 'Select group'}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            color: folderColor,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <Folder style={{ width: 14, height: 14 }} />
        </button>
        <span
          style={{
            fontSize: 13,
            color: 'var(--ink-0)',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {props.group.name}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            fontFamily: 'var(--sans)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {props.memberCount}
        </span>
      </div>
      <div style={cellStyle} />
      <div style={cellStyle} />
      <div
        style={{
          ...actionsClusterStyle,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 120ms var(--ease, ease)',
        }}
      >
        <IconButton
          label="Edit group"
          onClick={props.onEdit}
          icon={<Settings style={iconSize} />}
        />
        <IconButton
          label="Delete group"
          onClick={props.onDelete}
          icon={<Trash style={iconSize} />}
        />
      </div>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: WALLETS_GRID_TEMPLATE,
  alignItems: 'center',
  gap: 12,
  padding: '6px 10px',
  fontSize: 13,
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'background 120ms var(--ease, ease)',
};

const cellStyle: CSSProperties = { fontSize: 12 };

const actionsClusterStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 2,
};

const iconSize: CSSProperties = { width: 13, height: 13 };

function IconButton(props: {
  label: string;
  onClick: () => void;
  icon: React.ReactElement;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      title={props.label}
      aria-label={props.label}
      style={{
        background: 'transparent',
        border: 'none',
        borderRadius: 6,
        width: 22,
        height: 22,
        padding: 0,
        color: 'var(--ink-3)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--chip-bg)';
        e.currentTarget.style.color = 'var(--ink-1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--ink-3)';
      }}
    >
      {props.icon}
    </button>
  );
}
