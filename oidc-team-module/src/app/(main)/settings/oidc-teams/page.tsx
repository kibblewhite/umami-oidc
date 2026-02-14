/**
 * OIDC Team Claim Mappings — Settings Page
 *
 * Standalone admin page for managing automatic team assignment rules
 * based on OIDC identity provider claims.
 *
 * Accessible at: /settings/oidc-teams
 *
 * Uses @umami/react-zen components and shared Umami UI primitives
 * to match the rest of the settings interface.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button, Column, Heading, Icon, Label, ListItem, Row, Select, Text } from '@umami/react-zen';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { Plus, Trash2, X } from '@/components/icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Team {
  id: string;
  name: string;
}

interface ClaimRule {
  id: string;
  claimField: string;
  claimValue: string;
  teamRole: string;
  createdAt: string;
}

interface RulesMap {
  [teamId: string]: ClaimRule[];
}

// ---------------------------------------------------------------------------
// Auth helper — reads token same way as Umami's client
// ---------------------------------------------------------------------------

function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem('umami.auth');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getAuthToken()}`,
    'Content-Type': 'application/json',
  };
}

// ---------------------------------------------------------------------------
// Minimal inline styles (only for elements without react-zen equivalents)
// ---------------------------------------------------------------------------

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  height: 36,
  border: '1px solid var(--base300)',
  borderRadius: 4,
  fontSize: 14,
  width: '100%',
  backgroundColor: 'var(--base50)',
  color: 'var(--base900)',
  outline: 'none',
  boxSizing: 'border-box' as const,
};

const tagStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'monospace',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <Row
      alignItems="center"
      justifyContent="space-between"
      paddingY="3"
      paddingX="4"
      borderRadius="3"
      style={{ backgroundColor: 'var(--red50, #ffeef0)', color: 'var(--red700, #c62828)' }}
    >
      <Text style={{ color: 'inherit' }}>{message}</Text>
      <Button variant="quiet" size="sm" onPress={onDismiss}>
        <Icon><X /></Icon>
      </Button>
    </Row>
  );
}

function RuleTag({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: 'field' | 'value' | 'role';
}) {
  const colors = {
    field: { backgroundColor: 'var(--primary50, #e8f4fd)', color: 'var(--primary700, #0d47a1)' },
    value: { backgroundColor: 'var(--green50, #e8f5e9)', color: 'var(--green700, #2e7d32)' },
    role: { backgroundColor: 'var(--base100)', color: 'var(--base700)' },
  };

  return <span style={{ ...tagStyle, ...colors[variant] }}>{children}</span>;
}

function RuleRow({
  rule,
  onRemove,
}: {
  rule: ClaimRule;
  onRemove: () => void;
}) {
  return (
    <Row
      alignItems="center"
      justifyContent="space-between"
      paddingY="2"
      style={{ borderBottom: '1px solid var(--base100)' }}
    >
      <Row alignItems="center" gap="2" style={{ flexWrap: 'wrap' }}>
        <RuleTag variant="field">{rule.claimField}</RuleTag>
        <Text color="muted">=</Text>
        <RuleTag variant="value">{rule.claimValue}</RuleTag>
        <Text color="muted">→</Text>
        <RuleTag variant="role">{rule.teamRole === 'team_owner' ? 'Owner' : 'Member'}</RuleTag>
      </Row>
      <Button variant="quiet" size="sm" onPress={onRemove}>
        <Icon size="sm" color="muted"><Trash2 /></Icon>
      </Button>
    </Row>
  );
}

function AddRuleForm({
  teamId,
  form,
  adding,
  onFieldChange,
  onAdd,
}: {
  teamId: string;
  form: { claimField: string; claimValue: string; teamRole: string };
  adding: boolean;
  onFieldChange: (update: Partial<typeof form>) => void;
  onAdd: () => void;
}) {
  const canAdd = form.claimField.trim() && form.claimValue.trim() && !adding;

  return (
    <Row gap="3" alignItems="flex-end" paddingY="3" style={{ flexWrap: 'wrap' }}>
      <Column gap="1" style={{ flex: '1 1 140px', minWidth: 140 }}>
        <Label>Claim field</Label>
        <input
          style={inputStyle}
          placeholder="e.g. groups"
          value={form.claimField}
          onChange={e => onFieldChange({ claimField: e.target.value })}
          onKeyDown={e => e.key === 'Enter' && canAdd && onAdd()}
        />
      </Column>
      <Column gap="1" style={{ flex: '1 1 140px', minWidth: 140 }}>
        <Label>Claim value</Label>
        <input
          style={inputStyle}
          placeholder="e.g. analytics-team"
          value={form.claimValue}
          onChange={e => onFieldChange({ claimValue: e.target.value })}
          onKeyDown={e => e.key === 'Enter' && canAdd && onAdd()}
        />
      </Column>
      <Column gap="1" style={{ minWidth: 110 }}>
        <Label>Role</Label>
        <Select
          value={form.teamRole}
          onChange={(val: any) => onFieldChange({ teamRole: val as string })}
        >
          <ListItem id="team_member">Member</ListItem>
          <ListItem id="team_owner">Owner</ListItem>
        </Select>
      </Column>
      <Button
        variant="primary"
        onPress={onAdd}
        isDisabled={!canAdd}
      >
        <Icon><Plus /></Icon>
        Add Rule
      </Button>
    </Row>
  );
}

function TeamRulesPanel({
  team,
  rules,
  form,
  adding,
  onFieldChange,
  onAdd,
  onRemove,
}: {
  team: Team;
  rules: ClaimRule[];
  form: { claimField: string; claimValue: string; teamRole: string };
  adding: boolean;
  onFieldChange: (update: Partial<typeof form>) => void;
  onAdd: () => void;
  onRemove: (ruleId: string) => void;
}) {
  return (
    <Panel>
      <Row alignItems="center" justifyContent="space-between">
        <Heading size="2">{team.name}</Heading>
        <Text size="sm" color="muted">
          {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
        </Text>
      </Row>

      {rules.length > 0 ? (
        <Column>
          {rules.map(rule => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onRemove={() => onRemove(rule.id)}
            />
          ))}
        </Column>
      ) : (
        <Text color="muted" style={{ padding: '8px 0' }}>
          No claim rules configured for this team.
        </Text>
      )}

      <AddRuleForm
        teamId={team.id}
        form={form}
        adding={adding}
        onFieldChange={onFieldChange}
        onAdd={onAdd}
      />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function OidcTeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [rules, setRules] = useState<RulesMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Per-team form state
  const [newFields, setNewFields] = useState<
    Record<string, { claimField: string; claimValue: string; teamRole: string }>
  >({});

  // ---- Data fetching ----

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/oidc/team-rules', {
        headers: authHeaders(),
      });

      if (res.status === 403) {
        setError('Admin access required to manage OIDC team mappings.');
        setLoading(false);
        return;
      }

      if (res.status === 503) {
        setError('Redis is required for OIDC team mappings. Please configure REDIS_URL.');
        setLoading(false);
        return;
      }

      if (!res.ok) {
        throw new Error(`Failed to load data (${res.status})`);
      }

      const data = await res.json();
      setTeams(data.teams || []);
      setRules(data.rules || {});
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load team data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ---- Form helpers ----

  function getNewField(teamId: string) {
    return newFields[teamId] || { claimField: '', claimValue: '', teamRole: 'team_member' };
  }

  function setNewField(
    teamId: string,
    update: Partial<{ claimField: string; claimValue: string; teamRole: string }>,
  ) {
    setNewFields(prev => ({
      ...prev,
      [teamId]: { ...getNewField(teamId), ...update },
    }));
  }

  // ---- Actions ----

  async function handleAdd(teamId: string) {
    const { claimField, claimValue, teamRole } = getNewField(teamId);
    if (!claimField.trim() || !claimValue.trim()) return;

    setAdding(true);
    try {
      const res = await fetch('/api/auth/oidc/team-rules', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ teamId, claimField, claimValue, teamRole }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add rule');
      }

      const data = await res.json();
      setRules(prev => ({
        ...prev,
        [teamId]: [...(prev[teamId] || []), data.rule],
      }));
      setNewField(teamId, { claimField: '', claimValue: '' });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(teamId: string, ruleId: string) {
    try {
      const res = await fetch('/api/auth/oidc/team-rules', {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify({ teamId, ruleId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to remove rule');
      }

      setRules(prev => {
        const updated = { ...prev };
        updated[teamId] = (updated[teamId] || []).filter(r => r.id !== ruleId);
        if (updated[teamId].length === 0) delete updated[teamId];
        return updated;
      });
    } catch (err: any) {
      setError(err.message);
    }
  }

  // ---- Render ----

  if (loading) {
    return (
      <Column gap="6">
        <PageHeader title="OIDC Team Mappings" showBorder={false} />
        <Text color="muted">Loading teams…</Text>
      </Column>
    );
  }

  return (
    <Column gap="6">
      <PageHeader
        title="OIDC Team Mappings"
        description="Automatically assign users to teams based on identity provider claims."
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {teams.length === 0 ? (
        <Panel>
          <Text color="muted" style={{ textAlign: 'center', padding: '16px 0' }}>
            No teams found. Create a team in Settings → Teams first.
          </Text>
        </Panel>
      ) : (
        teams.map(team => (
          <TeamRulesPanel
            key={team.id}
            team={team}
            rules={rules[team.id] || []}
            form={getNewField(team.id)}
            adding={adding}
            onFieldChange={update => setNewField(team.id, update)}
            onAdd={() => handleAdd(team.id)}
            onRemove={ruleId => handleRemove(team.id, ruleId)}
          />
        ))
      )}

      <Panel>
        <Column gap="2">
          <Heading size="1">How it works</Heading>
          <Text color="muted" size="sm">
            When a user logs in via OIDC, their identity provider claims (such as{' '}
            <code>groups</code>, <code>department</code>, or <code>roles</code>) are
            compared against these rules. If a claim field contains the specified value,
            the user is automatically added to the corresponding team with the selected
            role. Rules are evaluated on every login.
          </Text>
        </Column>
      </Panel>
    </Column>
  );
}
