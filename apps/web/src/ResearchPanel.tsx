import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './lib/api';

export function ResearchPanel({ projectId, sectionId, title }: { projectId: string; sectionId: string | null; title: string }) {
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const sources = useQuery({ queryKey: ['research', projectId, sectionId], queryFn: () => api.research(projectId, sectionId) });
  const search = useMutation({
    mutationFn: () => api.search(projectId, query.trim(), sectionId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['research', projectId] }),
  });
  return <details className="research-panel">
    <summary>Research · {sources.data?.length ?? 0} saved sources</summary>
    <p className="research-note">Sources for {title}. Search excerpts are candidates, not verified facts. Saved sources are shared with the producer for this section.</p>
    <form className="research-search" onSubmit={event => { event.preventDefault(); if (!search.isPending && query.trim()) search.mutate(); }}>
      <input aria-label="Web search query" placeholder={`Search about ${title}…`} value={query} onChange={event => setQuery(event.target.value)} maxLength={1000} />
      <button className="button button-default" disabled={search.isPending || !query.trim()}>{search.isPending ? 'Searching…' : 'Search'}</button>
    </form>
    {search.isError && <p role="alert" className="research-error">{search.error.message}</p>}
    {sources.isError && <p role="alert" className="research-error">{sources.error.message}</p>}
    {search.isSuccess && <p className="research-note">{search.data.sources.length} results via {search.data.provider}{search.data.fallbackUsed ? ' (backup)' : ''}. {search.data.warnings.join(' ')}</p>}
    <div className="research-cards">{sources.data?.map(source => <article className="research-card" key={source.id}>
      <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
      <p>{source.excerpt || 'No excerpt supplied. Open the source to review it.'}</p>
      <small>{source.provider} · Unverified · Retrieved {new Date(source.retrievedAt).toLocaleDateString()}{source.publicationDate ? ` · Publication: ${source.publicationDate}` : ''}</small>
    </article>)}</div>
  </details>;
}

export function IntegrationSettings({ open }: { open: boolean }) {
  const status = useQuery({ queryKey: ['integrations'], queryFn: api.integrations, enabled: open });
  const test = useMutation({ mutationFn: api.testSearch });
  return <section className="integration-settings">
    <h4>Server integrations</h4>
    {status.isLoading && <p>Reading server configuration…</p>}
    {status.isError && <p role="alert">{status.error.message}</p>}
    {status.data && <>
      <p className="setting-note">OpenRouter: {status.data.ai.openrouter ? 'key configured' : 'key missing'}. Ollama uses your local server; Refresh checks installed models.</p>
      {(['primary', 'backup'] as const).map(slot => <div className="integration-row" key={slot}>
        <span>{slot === 'primary' ? 'Primary search' : 'Backup search'}: {status.data.search[slot].provider} · {status.data.search[slot].configured ? 'key configured' : 'key missing'}</span>
        <button className="button button-ghost" onClick={() => test.mutate(slot)} disabled={test.isPending || !status.data.search[slot].configured}>Test</button>
      </div>)}
      <p className="setting-note">Tests make one search request and may use provider credits. Automatic failover is enabled.</p>
      <p className="setting-note">Stock/generation keys: Pexels {status.data.assets.pexels ? 'configured' : 'missing'}, Pixabay {status.data.assets.pixabay ? 'configured' : 'missing'}, Runware {status.data.assets.runware ? 'configured' : 'missing'}. These asset integrations are not implemented yet; local uploads work. No paid image generation runs automatically.</p>
    </>}
    {test.isPending && <p role="status">Checking {test.variables} search…</p>}
    {test.isSuccess && <p role="status">{test.data.provider}: connected, {test.data.resultCount} result(s).</p>}
    {test.isError && <p role="alert" className="research-error">{test.error.message}</p>}
  </section>;
}
