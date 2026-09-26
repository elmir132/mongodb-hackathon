import React, { useRef } from 'react';

const companyFor = selection => selection.startsWith('anthropic') ? 'anthropic' : selection === 'compatible' ? 'custom' : 'openai';

export default function ModelSelector({ selection, onChange, providers, disabled, replaying, onConnect }) {
  const remembered = useRef({ openai: 'codex', anthropic: 'anthropic:claude-sonnet-5', custom: 'compatible' });
  const company = companyFor(selection);
  const provider = selection.split(':')[0];
  const configured = providers.find(item => item.id === provider)?.configured;
  const modelOptions = {
    openai: [
      { value: 'codex', label: 'Luna · Fast (Codex)' },
      { value: 'codex:gpt-6-sol', label: 'Sol · Standard (Codex)' },
      { value: 'openai', label: providers.find(item => item.id === 'openai')?.model || 'API model…' },
    ],
    anthropic: [
      { value: 'anthropic:claude-sonnet-5', label: 'Claude Sonnet 5' },
      { value: 'anthropic:claude-opus-5-5', label: 'Claude Opus 5.5' },
    ],
    custom: [{ value: 'compatible', label: providers.find(item => item.id === 'compatible')?.model || 'Custom model…' }],
  };
  function changeCompany(next) {
    remembered.current[company] = selection;
    onChange(remembered.current[next]);
  }
  return <div className="model-control">
    <label htmlFor="model-company" className="sr-only">AI company</label>
    <select id="model-company" value={company} disabled={disabled} onChange={event => changeCompany(event.target.value)}>
      <option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">Custom</option>
    </select>
    <label htmlFor="model" className="sr-only">AI model</label>
    <select id="model" value={selection} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {modelOptions[company].map(model => <option key={model.value} value={model.value}>{model.label}</option>)}
    </select>
    {provider !== 'codex' && !replaying && <button type="button" onClick={onConnect} disabled={disabled}>{configured ? 'Configure' : 'Connect'}</button>}
  </div>;
}
