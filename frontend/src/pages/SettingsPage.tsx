import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sun, Moon, Save, CheckCircle2, FolderOpen, Wifi, WifiOff, RefreshCw, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { useAppStore } from '../lib/store';
import { Spinner, Badge } from '../components/ui/shared';

export default function SettingsPage(){
  const{theme,toggleTheme}=useAppStore();
  const qc=useQueryClient();
  const{data:settings,isLoading}=useQuery({queryKey:['settings'],queryFn:api.getSettings});
  const{data:health}=useQuery({queryKey:['health'],queryFn:api.health,retry:false});

  const[form,setForm]=useState({
    parent_dir:'',
    update_directory:'',update_manifest_url:'',
    openai_api_key:'',captcha_ai_model:'gpt-4.1-mini',
    backend_mode:'local',backend_url:'',backend_api_key:'',backend_admin_key:'',
    auto_archive_enabled:'false',
    local_archive_interval_hours:'12',server_archive_interval_hours:'12',
    project_details_show_tender_info:'true',projects_entry_mode:'inline',
  });
  const[saved,setSaved]=useState(false);
  const[testStatus,setTestStatus]=useState('');
  const desktop = (window as Window & {
    bidmanagerDesktop?: {
      openPath?: (path: string) => Promise<{ ok: boolean; canceled?: boolean; message?: string }>;
      pickPath?: (options?: { file?: boolean; title?: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; message?: string }>;
    };
  }).bidmanagerDesktop;

  const deriveParent = (s: Record<string, string>) => {
    if (s.parent_dir) return String(s.parent_dir);
    const proj = String(s.projects_dir || '');
    const marker = `${proj.includes('\\') ? '\\' : '/'}My_Tender_Projects`;
    if (proj.endsWith(marker)) return proj.slice(0, -marker.length);
    const db = String(s.db_file || '');
    const idx = Math.max(db.lastIndexOf('\\'), db.lastIndexOf('/'));
    return idx > 0 ? db.slice(0, idx) : '';
  };

  useEffect(()=>{if(settings)setForm(f=>{const s=settings;return{...f,
    parent_dir:deriveParent(s)||f.parent_dir,
    update_directory:s.update_directory||f.update_directory,
    update_manifest_url:s.update_manifest_url||f.update_manifest_url,
    openai_api_key:s.openai_api_key||f.openai_api_key,
    captcha_ai_model:s.captcha_ai_model||f.captcha_ai_model,
    backend_mode:s.backend_mode||f.backend_mode,backend_url:s.backend_url||f.backend_url,
    backend_api_key:s.backend_api_key||f.backend_api_key,backend_admin_key:s.backend_admin_key||f.backend_admin_key,
    auto_archive_enabled:s.auto_archive_enabled??f.auto_archive_enabled,
    local_archive_interval_hours:s.local_archive_interval_hours||f.local_archive_interval_hours,
    server_archive_interval_hours:s.server_archive_interval_hours||f.server_archive_interval_hours,
    project_details_show_tender_info:s.project_details_show_tender_info||f.project_details_show_tender_info,
    projects_entry_mode:s.projects_entry_mode||f.projects_entry_mode,
  }})},[settings]);

  const saveMut=useMutation({mutationFn:(d:Record<string,string>)=>api.updateSettings(d),onSuccess:()=>{qc.invalidateQueries({queryKey:['settings']});window.dispatchEvent(new Event('bm-settings-updated'));setSaved(true);setTimeout(()=>setSaved(false),2000)}});
  const handleSave=()=>saveMut.mutate(form);
  const uf=(k:string,v:string)=>setForm(f=>({...f,[k]:v}));

  const browseForPath = async (key: string, label: string, file = false) => {
    try {
      if (!desktop?.pickPath) {
        setTestStatus('Browse is available in Electron desktop app.');
        return;
      }
      const result = await desktop.pickPath({ file, title: `Select ${label}` });
      if (result?.ok && result.path) uf(key, result.path);
      else if (result && !result.canceled && result.message) setTestStatus(`Browse failed: ${result.message}`);
    } catch (e: any) {
      setTestStatus(`Browse failed: ${e?.message || String(e)}`);
    }
  };

  const testConnection=async()=>{
    setTestStatus('Testing...');
    try{const h=await api.health();setTestStatus(`Connected. Version: ${h.version}`)}
    catch(e:any){setTestStatus(`Failed: ${e.message}`)}
  };

  return(<div className="flex flex-col h-full overflow-auto">
    <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-0)]">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-[var(--text)]">Settings</h1>
        <div className="flex items-center gap-2">
          {health?<Badge variant="success"><Wifi size={10}/>Connected v{health.version}</Badge>:<Badge variant="danger"><WifiOff size={10}/>Offline</Badge>}
        </div>
      </div>
    </div>
    {isLoading?<div className="flex justify-center py-16"><Spinner size={24} className="text-[var(--accent)]"/></div>:
    <div className="p-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      <div className="space-y-6 xl:col-span-7">
      {/* Appearance */}
      <div className="card p-5 space-y-4"><h3 className="text-sm font-semibold text-[var(--text)]">Appearance</h3>
        <div className="flex items-center justify-between"><div><p className="text-sm text-[var(--text)]">Theme</p><p className="text-xs text-[var(--text-muted)]">Light / Dark mode</p></div><button onClick={toggleTheme} className="btn-secondary text-sm gap-2">{theme==='dark'?<Sun size={14}/>:<Moon size={14}/>}{theme==='dark'?'Light':'Dark'}</button></div>
        <div className="flex items-center justify-between"><div><p className="text-sm text-[var(--text)]">Projects entry mode</p><p className="text-xs text-[var(--text-muted)]">Inline form or popup dialog</p></div>
          <div className="relative w-36">
            <select value={form.projects_entry_mode} onChange={e=>uf('projects_entry_mode',e.target.value)} className="input-field h-9 w-full appearance-none pr-8 text-sm">
              <option value="inline">Inline</option>
              <option value="popup">Popup</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"/>
          </div>
        </div>
        <div className="flex items-center justify-between"><div><p className="text-sm text-[var(--text)]">Show Tender Info panel</p><p className="text-xs text-[var(--text-muted)]">In project details view</p></div>
          <input type="checkbox" checked={form.project_details_show_tender_info==='true'} onChange={e=>uf('project_details_show_tender_info',e.target.checked?'true':'false')} className="accent-[var(--accent)] w-5 h-5"/></div>
      </div>

      {/* Directory Paths */}
      <div className="card p-5 space-y-4"><h3 className="text-sm font-semibold text-[var(--text)]">Directory Paths</h3>
        <p className="text-xs text-[var(--text-muted)]">Choose one parent folder. App auto-creates and uses standard internal paths.</p>
        <div>
          <label className="text-xs text-[var(--text-muted)] mb-1 block">Parent Folder</label>
          <div className="flex gap-2">
            <input value={form.parent_dir} onChange={e=>uf('parent_dir',e.target.value)} className="input-field h-9 text-sm flex-1" placeholder="Path to parent folder"/>
            <button onClick={() => browseForPath('parent_dir', 'Parent Folder', false)} className="btn-secondary text-xs px-3 gap-1 shrink-0"><FolderOpen size={13}/>Browse</button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 text-xs text-[var(--text-muted)]">
          <div>Database: <span className="text-[var(--text)]">{form.parent_dir ? `${form.parent_dir}${form.parent_dir.endsWith('\\') || form.parent_dir.endsWith('/') ? '' : '\\'}tender_manager.db` : '-'}</span></div>
          <div>Projects: <span className="text-[var(--text)]">{form.parent_dir ? `${form.parent_dir}${form.parent_dir.endsWith('\\') || form.parent_dir.endsWith('/') ? '' : '\\'}My_Tender_Projects` : '-'}</span></div>
          <div>Downloads: <span className="text-[var(--text)]">{form.parent_dir ? `${form.parent_dir}${form.parent_dir.endsWith('\\') || form.parent_dir.endsWith('/') ? '' : '\\'}Tender_Downloads` : '-'}</span></div>
          <div>Templates: <span className="text-[var(--text)]">{form.parent_dir ? `${form.parent_dir}${form.parent_dir.endsWith('\\') || form.parent_dir.endsWith('/') ? '' : '\\'}Checklist_Templates` : '-'}</span></div>
          <div>Updates: <span className="text-[var(--text)]">{form.parent_dir ? `${form.parent_dir}${form.parent_dir.endsWith('\\') || form.parent_dir.endsWith('/') ? '' : '\\'}Updates` : '-'}</span></div>
        </div>
      </div>
      </div>

      <div className="space-y-6 xl:col-span-5">

      {/* CAPTCHA AI */}
      <div className="card p-5 space-y-4"><h3 className="text-sm font-semibold text-[var(--text)]">CAPTCHA AI (ChatGPT)</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div><label className="text-xs text-[var(--text-muted)] mb-1 block">OpenAI API Key</label><input type="password" value={(form as any).openai_api_key || ''} onChange={e=>uf('openai_api_key',e.target.value)} className="input-field h-9 text-sm w-full" placeholder="sk-..." /></div>
          <div><label className="text-xs text-[var(--text-muted)] mb-1 block">CAPTCHA Model</label><input value={(form as any).captcha_ai_model || 'gpt-4.1-mini'} onChange={e=>uf('captcha_ai_model',e.target.value)} className="input-field h-9 text-sm w-full" placeholder="gpt-4.1-mini" /></div>
        </div>
      </div>

      {/* Backend */}
      <div className="card p-5 space-y-4"><h3 className="text-sm font-semibold text-[var(--text)]">Backend Configuration</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-[var(--text-muted)] mb-1 block">Mode</label><select value={form.backend_mode} onChange={e=>uf('backend_mode',e.target.value)} className="input-field h-9 text-sm w-full"><option value="local">Local</option><option value="remote">Remote (Railway/API)</option></select></div>
          <div><label className="text-xs text-[var(--text-muted)] mb-1 block">Backend URL</label><input value={form.backend_url} onChange={e=>uf('backend_url',e.target.value)} className="input-field h-9 text-sm w-full" placeholder="https://server.com/api" disabled={form.backend_mode!=='remote'}/></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-[var(--text-muted)] mb-1 block">API Key</label><input type="password" value={form.backend_api_key} onChange={e=>uf('backend_api_key',e.target.value)} className="input-field h-9 text-sm w-full" disabled={form.backend_mode!=='remote'}/></div>
          <div><label className="text-xs text-[var(--text-muted)] mb-1 block">Admin Key</label><input type="password" value={form.backend_admin_key} onChange={e=>uf('backend_admin_key',e.target.value)} className="input-field h-9 text-sm w-full" disabled={form.backend_mode!=='remote'}/></div>
        </div>
        <div className="flex items-center gap-3"><button onClick={testConnection} className="btn-secondary text-sm gap-1"><RefreshCw size={14}/>Test Connection</button>{testStatus&&<span className={`text-xs ${testStatus.includes('Connected')?'text-emerald-400':'text-rose-400'}`}>{testStatus}</span>}</div>
      </div>

      {/* Auto-Archive */}
      <div className="card p-5 space-y-4"><h3 className="text-sm font-semibold text-[var(--text)]">Auto-Archive</h3>
        <label className="flex items-start justify-between gap-4 cursor-pointer">
          <div><p className="text-sm text-[var(--text)]">Automatically check archived tender status</p><p className="text-xs text-[var(--text-muted)]">Runs status checks and archives completed tenders at the configured interval.</p></div>
          <input type="checkbox" checked={form.auto_archive_enabled==='true'} onChange={e=>uf('auto_archive_enabled',e.target.checked?'true':'false')} className="mt-0.5 accent-[var(--accent)] w-5 h-5 shrink-0"/>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-[var(--text-muted)] mb-1 block">Local interval (hours)</label><input type="number" min={1} max={720} value={form.local_archive_interval_hours} onChange={e=>uf('local_archive_interval_hours',e.target.value)} className="input-field h-9 text-sm w-32"/></div>
          <div><label className="text-xs text-[var(--text-muted)] mb-1 block">Server interval (hours)</label><input type="number" min={1} max={720} value={form.server_archive_interval_hours} onChange={e=>uf('server_archive_interval_hours',e.target.value)} className="input-field h-9 text-sm w-32"/></div>
        </div>
      </div>

      {/* Updates */}
      <div className="card p-5 space-y-4"><h3 className="text-sm font-semibold text-[var(--text)]">Updates</h3>
        <div><label className="text-xs text-[var(--text-muted)] mb-1 block">Update Manifest URL</label><input value={form.update_manifest_url} onChange={e=>uf('update_manifest_url',e.target.value)} className="input-field h-9 text-sm w-full" placeholder="https://domain.com/updates/build_version.json"/></div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pb-6 xl:pb-0">
        <button onClick={handleSave} disabled={saveMut.isPending} className="btn-primary text-sm gap-1.5">
          {saveMut.isPending?<Spinner size={14}/>:saved?<CheckCircle2 size={14}/>:<Save size={14}/>}{saved?'Saved!':'Save Settings'}
        </button>
      </div>
      </div>
      </div>
    </div>}
  </div>);
}
