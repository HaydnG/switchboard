import { useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEvalRuns, useKnowledgeBase } from '@renderer/hooks/useKnowledgeBase';
import { KnowledgeGraph } from '@renderer/components/knowledge/KnowledgeGraph';
import { KnowledgeOverview } from '@renderer/components/knowledge/KnowledgeOverview';
import { KnowledgeReader } from '@renderer/components/knowledge/KnowledgeReader';
import { KnowledgeSearch } from '@renderer/components/knowledge/KnowledgeSearch';
import { KnowledgeSidebar } from '@renderer/components/knowledge/KnowledgeSidebar';
import { KnowledgeView } from '@renderer/components/knowledge/KnowledgeView';
import {
  INITIAL_SEARCH_STATE,
  type KbSearchState,
  type KbTab,
} from '@renderer/components/knowledge/kb-ui';

interface KnowledgeTargets {
  sidebar: HTMLElement;
  view: HTMLElement;
}

/** The Knowledge tab: a file tree in the legacy sidebar and the main view in #kb-viewer. */
export function KnowledgeHost() {
  const [targets] = useState<KnowledgeTargets | null>(() => {
    const sidebar = document.getElementById('kb-content');
    const view = document.getElementById('kb-viewer');
    return sidebar && view ? { sidebar, view } : null;
  });
  return targets ? <KnowledgeTab targets={targets} /> : null;
}

function KnowledgeTab({ targets }: { targets: KnowledgeTargets }) {
  const kb = useKnowledgeBase();
  const evalRuns = useEvalRuns();
  const [tab, setTab] = useState<KbTab>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState<KbSearchState>(INITIAL_SEARCH_STATE);

  const openEntry = useCallback((id: string) => {
    setSelectedId(id);
    setTab('reader');
  }, []);

  const selectFromTree = useCallback((id: string) => {
    setSelectedId(id);
    setTab((current) => (current === 'graph' ? current : 'reader'));
  }, []);

  const showInGraph = useCallback((id: string) => {
    setSelectedId(id);
    setTab('graph');
  }, []);

  const updateSearch = useCallback(
    (update: (current: KbSearchState) => KbSearchState) => setSearch(update),
    [],
  );

  let body: ReactNode;
  if (tab === 'overview') body = <KnowledgeOverview kb={kb} onOpen={openEntry} />;
  else if (tab === 'reader') {
    body = (
      <KnowledgeReader
        kb={kb}
        entryId={selectedId}
        onNavigate={openEntry}
        onShowInGraph={showInGraph}
      />
    );
  } else if (tab === 'graph') {
    body = (
      <KnowledgeGraph kb={kb} focusId={selectedId} onFocus={setSelectedId} onOpen={openEntry} />
    );
  } else {
    body = (
      <KnowledgeSearch
        kb={kb}
        evalRuns={evalRuns}
        state={search}
        setState={updateSearch}
        onOpen={openEntry}
      />
    );
  }

  return (
    <>
      {createPortal(
        <KnowledgeSidebar kb={kb} selectedId={selectedId} onSelect={selectFromTree} />,
        targets.sidebar,
      )}
      {createPortal(
        <KnowledgeView kb={kb} tab={tab} onTab={setTab}>
          {body}
        </KnowledgeView>,
        targets.view,
      )}
    </>
  );
}
