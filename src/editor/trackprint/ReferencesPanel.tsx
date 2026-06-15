import { useRef, useState } from 'react';
import { FileText, ImageIcon, Link2, MapPin, Paperclip, Trash2 } from 'lucide-react';
import { formatBytes, type ReferenceItem, type ReferenceKind } from './references';

interface ReferencesPanelProps {
  readonly references: readonly ReferenceItem[];
  readonly error: string;
  readonly onFetchRealWorld: () => void;
  readonly onAddFiles: (files: FileList | null) => void;
  readonly onAddLink: (url: string, name?: string) => void;
  readonly onAddNote: (body: string, name?: string) => void;
  readonly onRemove: (id: string) => void;
}

const KIND_ICON: Record<ReferenceKind, typeof ImageIcon> = {
  image: ImageIcon,
  data: FileText,
  link: Link2,
  note: FileText,
};

export function ReferencesPanel(props: ReferencesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [noteBody, setNoteBody] = useState('');

  return (
    <div className="references-panel" data-testid="references-panel">
      <p className="tool-hint">
        Attach reference material to guide track creation — course maps, photos, timing or GIS
        data, links, and notes. References are saved with the project but don&apos;t change the
        compiled track.
      </p>

      <button
        type="button"
        className="tool-action tool-action--primary"
        onClick={props.onFetchRealWorld}
        data-testid="reference-fetch-realworld"
      >
        <MapPin size={13} /> Fetch real-world location
      </button>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.json,.csv,.txt,.gpx,.geojson,.kml,.xml,application/json,text/*"
        style={{ display: 'none' }}
        data-testid="reference-file-input"
        onChange={(event) => {
          props.onAddFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <button
        type="button"
        className="tool-action"
        onClick={() => fileInputRef.current?.click()}
        data-testid="reference-add-file"
      >
        <Paperclip size={13} /> Add image / data file
      </button>

      <div className="references-add">
        <strong className="references-subhead">Add link</strong>
        <input
          aria-label="Reference link URL"
          placeholder="https://…"
          value={linkUrl}
          onChange={(event) => setLinkUrl(event.currentTarget.value)}
        />
        <input
          aria-label="Reference link name"
          placeholder="label (optional)"
          value={linkName}
          onChange={(event) => setLinkName(event.currentTarget.value)}
        />
        <button
          type="button"
          className="tool-action"
          onClick={() => {
            props.onAddLink(linkUrl, linkName);
            setLinkUrl('');
            setLinkName('');
          }}
        >
          Add link
        </button>
      </div>

      <div className="references-add">
        <strong className="references-subhead">Add note</strong>
        <textarea
          aria-label="Reference note body"
          placeholder="Notes about the layout, corners, surfaces…"
          rows={3}
          value={noteBody}
          onChange={(event) => setNoteBody(event.currentTarget.value)}
        />
        <button
          type="button"
          className="tool-action"
          onClick={() => {
            props.onAddNote(noteBody);
            setNoteBody('');
          }}
        >
          Add note
        </button>
      </div>

      {props.error ? <p className="tool-error">{props.error}</p> : null}

      <div className="tool-inspector-divider" />
      <strong className="references-subhead">
        Attached ({props.references.length})
      </strong>
      {props.references.length === 0 ? (
        <p className="tool-hint">Nothing attached yet.</p>
      ) : (
        <ul className="references-list" data-testid="references-list">
          {props.references.map((reference) => {
            const Icon = KIND_ICON[reference.kind];
            return (
              <li key={reference.id} className="references-item">
                {reference.kind === 'image' ? (
                  <img className="references-thumb" src={reference.content} alt={reference.name} />
                ) : (
                  <span className="references-thumb references-thumb--icon">
                    <Icon size={16} />
                  </span>
                )}
                <span className="references-meta">
                  <span className="references-name" title={reference.name}>
                    {reference.kind === 'link' ? (
                      <a href={reference.content} target="_blank" rel="noreferrer">
                        {reference.name}
                      </a>
                    ) : (
                      reference.name
                    )}
                  </span>
                  <span className="references-detail">
                    {reference.kind}
                    {reference.sizeBytes ? ` · ${formatBytes(reference.sizeBytes)}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="references-remove"
                  aria-label={`Remove ${reference.name}`}
                  onClick={() => props.onRemove(reference.id)}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
