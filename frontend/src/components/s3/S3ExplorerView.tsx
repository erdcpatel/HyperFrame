import React, { useState, useEffect } from 'react';
import {
  Cloud,
  Folder,
  FileText,
  ChevronRight,
  Database,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  HardDrive,
  Eye,
  Key,
  ShieldCheck,
  Search,
  ArrowUp,
  FolderPlus,
  Layers,
  ArrowRight,
  Edit2,
  X,
  FileCode,
  Sparkles,
  Download,
  Zap
} from 'lucide-react';
import { S3ProfilePublic, S3BrowseResponse, DatasetWeather } from '../../types';
import {
  fetchS3Profiles,
  saveS3Profile,
  deleteS3Profile,
  testS3Connection,
  browseS3Folder,
  previewS3Data,
  registerS3Dataset,
  downloadS3Dataset
} from '../../services/api';

interface Props {
  onDatasetRegistered: (weather: DatasetWeather) => void;
  onNavigateToStudio?: () => void;
}

export const S3ExplorerView: React.FC<Props> = ({ onDatasetRegistered, onNavigateToStudio }) => {
  // Profiles State
  const [profiles, setProfiles] = useState<S3ProfilePublic[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [searchProfiles, setSearchProfiles] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; latency?: number; message: string } | null>(null);

  // Connection Form State
  const [isEditingConnection, setIsEditingConnection] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [bucketName, setBucketName] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [useSsl, setUseSsl] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Folder Browser State
  const [currentPrefix, setCurrentPrefix] = useState('');
  const [browseData, setBrowseData] = useState<S3BrowseResponse | null>(null);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  // Live Preview & Ingestion State
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [previewCols, setPreviewCols] = useState<string[]>([]);
  const [previewColTypes, setPreviewColTypes] = useState<Record<string, string>>({});
  const [previewLatency, setPreviewLatency] = useState<number | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [targetDatasetId, setTargetDatasetId] = useState('');
  const [recursiveGlob, setRecursiveGlob] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  // Load profiles on mount
  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      const data = await fetchS3Profiles();
      setProfiles(data);
      if (data.length > 0 && !selectedProfileId) {
        setSelectedProfileId(data[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load S3 profiles:', err);
    }
  };

  // Browse folder when active profile or prefix changes
  useEffect(() => {
    if (selectedProfileId) {
      handleBrowseFolder(selectedProfileId, currentPrefix);
    }
  }, [selectedProfileId, currentPrefix]);

  const handleBrowseFolder = async (profileId: string, prefix: string) => {
    setLoadingBrowse(true);
    setBrowseError(null);
    try {
      const data = await browseS3Folder(profileId, prefix);
      setBrowseData(data);
      // Auto-populate target dataset name based on active folder
      const segs = prefix.split('/').filter(Boolean);
      const lastSeg = segs.length > 0 ? segs[segs.length - 1] : data.bucket;
      setTargetDatasetId(`s3_${lastSeg.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`);
    } catch (err: any) {
      setBrowseError(err.message || 'Failed to browse folder on S3 server');
    } finally {
      setLoadingBrowse(false);
    }
  };

  const handleTestConnection = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await testS3Connection(id);
      setTestResult({ id, success: true, latency: res.latency_ms, message: res.message });
    } catch (err: any) {
      setTestResult({ id, success: false, message: err.message || 'Connection test failed' });
    } finally {
      setTestingId(null);
    }
  };

  const handleStartEdit = (p: S3ProfilePublic, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingProfileId(p.id);
    setProfileName(p.name);
    setBucketName(p.bucket);
    setEndpointUrl(p.endpoint_url || '');
    setUseSsl(p.use_ssl !== false);
    setAccessKey(p.access_key_masked === 'None' ? '' : p.access_key_masked);
    setSecretKey('');
    setFormError(null);
    setIsEditingConnection(true);
  };

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim() || !bucketName.trim()) {
      setFormError('Please enter Connection Name and Bucket Name.');
      return;
    }
    setSavingProfile(true);
    setFormError(null);
    try {
      const id = editingProfileId || profileName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      await saveS3Profile({
        id,
        name: profileName.trim(),
        bucket: bucketName.trim(),
        endpoint_url: endpointUrl.trim() || undefined,
        access_key_id: accessKey.trim(),
        secret_access_key: secretKey.trim(),
        use_ssl: useSsl,
        region: 'us-east-1',
      });

      setIsEditingConnection(false);
      setEditingProfileId(null);
      setProfileName('');
      setBucketName('');
      setAccessKey('');
      setSecretKey('');
      setEndpointUrl('');
      setUseSsl(true);
      await loadProfiles();
      setSelectedProfileId(id);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save S3 configuration');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDeleteConnection = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm('Are you sure you want to delete this S3 connection profile?')) return;
    try {
      await deleteS3Profile(id);
      const remaining = profiles.filter((p) => p.id !== id);
      setProfiles(remaining);
      if (selectedProfileId === id) {
        setSelectedProfileId(remaining.length > 0 ? remaining[0].id : '');
        setCurrentPrefix('');
      }
    } catch (err: any) {
      alert(`Failed to delete profile: ${err.message}`);
    }
  };

  const handleFolderClick = (subfolder: string) => {
    setCurrentPrefix((prev) => (prev ? `${prev.replace(/\/$/, '')}/${subfolder}/` : `${subfolder}/`));
  };

  const handleBreadcrumbClick = (index: number, parts: string[]) => {
    if (index === -1) {
      setCurrentPrefix('');
    } else {
      const newPrefix = parts.slice(0, index + 1).join('/') + '/';
      setCurrentPrefix(newPrefix);
    }
  };

  const handleGoUp = () => {
    const parts = currentPrefix.split('/').filter(Boolean);
    if (parts.length <= 1) {
      setCurrentPrefix('');
    } else {
      parts.pop();
      setCurrentPrefix(parts.join('/') + '/');
    }
  };

  const handlePreview = async () => {
    if (!selectedProfileId) return;
    setLoadingPreview(true);
    setPreviewError(null);
    setPreviewOpen(true);
    try {
      const res = await previewS3Data({
        profile_id: selectedProfileId,
        folder_prefix: currentPrefix,
        recursive_glob: recursiveGlob,
        limit: 100
      });
      setPreviewRows(res.rows || []);
      setPreviewCols(res.columns || []);
      setPreviewColTypes(res.column_types || {});
      setPreviewLatency(res.latency_ms);
    } catch (err: any) {
      setPreviewError(err.message || 'Failed to fetch zero-copy preview from S3');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleRegisterAndOpen = async () => {
    if (!selectedProfileId || !targetDatasetId.trim()) return;
    setRegistering(true);
    setActionStatus('Registering remote S3 dataset...');
    try {
      const activeProf = profiles.find((p) => p.id === selectedProfileId);
      const newWeather = await registerS3Dataset({
        dataset_id: targetDatasetId.trim(),
        profile_id: selectedProfileId,
        folder_prefix: currentPrefix,
        recursive_glob: recursiveGlob,
        description: `S3 folder '${currentPrefix || '/'}' from bucket '${activeProf?.bucket}'`,
      });
      onDatasetRegistered(newWeather);
    } catch (err: any) {
      alert(`Registration failed: ${err.message}`);
    } finally {
      setRegistering(false);
      setActionStatus(null);
    }
  };

  const handleDownloadAndIngest = async () => {
    if (!selectedProfileId || !targetDatasetId.trim()) return;
    setDownloading(true);
    setActionStatus('Downloading parquet files via Boto3 to backend/data/...');
    try {
      const activeProf = profiles.find((p) => p.id === selectedProfileId);
      const newWeather = await downloadS3Dataset({
        dataset_id: targetDatasetId.trim(),
        profile_id: selectedProfileId,
        folder_prefix: currentPrefix,
        recursive_glob: recursiveGlob,
        description: `Downloaded from S3 '${activeProf?.bucket}/${currentPrefix}'`,
      });
      onDatasetRegistered(newWeather);
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloading(false);
      setActionStatus(null);
    }
  };

  const activeProfile = profiles.find((p) => p.id === selectedProfileId);
  const breadcrumbParts = currentPrefix.split('/').filter(Boolean);

  // Filter subfolders and files
  const filteredSubfolders = (browseData?.subfolders || []).filter((f) =>
    f.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const filteredFiles = (browseData?.files || []).filter((f) =>
    f.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="flex-1 flex min-h-0 min-w-0 bg-[#0a0e17] text-slate-100 select-none overflow-hidden">
      {/* ============================================================== */}
      {/* 1. LEFT RAIL: S3 CONNECTIONS & BUCKET PROFILES */}
      {/* ============================================================== */}
      <div className="w-80 flex flex-col border-r border-[#1e2a42] bg-[#0c1220] shrink-0">
        {/* Rail Header */}
        <div className="p-4 border-b border-[#1b2640] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-slate-200 uppercase tracking-wider">S3 Connections</h2>
              <p className="text-[10px] text-slate-400 font-mono">{profiles.length} Configured</p>
            </div>
          </div>
          <button
            onClick={() => {
              setEditingProfileId(null);
              setProfileName('');
              setBucketName('');
              setEndpointUrl('');
              setAccessKey('');
              setSecretKey('');
              setUseSsl(true);
              setFormError(null);
              setIsEditingConnection(true);
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition-all shadow-md shadow-blue-900/30"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </div>

        {/* Search Connections */}
        <div className="p-2 border-b border-[#182338]">
          <div className="flex items-center gap-2 bg-[#080c14] border border-[#202d47] rounded-lg px-2.5 py-1.5 text-xs text-slate-300">
            <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input
              type="text"
              placeholder="Filter connections..."
              value={searchProfiles}
              onChange={(e) => setSearchProfiles(e.target.value)}
              className="bg-transparent border-none outline-none text-xs text-slate-200 placeholder-slate-600 w-full font-mono"
            />
          </div>
        </div>

        {/* Connections List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {profiles
            .filter((p) => p.name.toLowerCase().includes(searchProfiles.toLowerCase()) || p.bucket.toLowerCase().includes(searchProfiles.toLowerCase()))
            .map((p) => {
              const isSelected = p.id === selectedProfileId;
              return (
                <div
                  key={p.id}
                  onClick={() => {
                    setSelectedProfileId(p.id);
                    setCurrentPrefix('');
                    setPreviewOpen(false);
                  }}
                  className={`p-3 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#15213b] border-blue-500/70 shadow-lg shadow-blue-950/40'
                      : 'bg-[#0e1628] border-[#1c2944] hover:border-slate-500/50 hover:bg-[#121c33]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-100 truncate">{p.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleStartEdit(p, e)}
                        className="p-1 hover:bg-[#1f2e4e] rounded text-slate-400 hover:text-sky-300 transition-colors"
                        title="Edit Connection"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => handleTestConnection(p.id, e)}
                        disabled={testingId === p.id}
                        className="p-1 hover:bg-[#1f2e4e] rounded text-slate-400 hover:text-emerald-300 transition-colors"
                        title="Test Connection"
                      >
                        <RotateCw className={`w-3 h-3 ${testingId === p.id ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={(e) => handleDeleteConnection(p.id, e)}
                        className="p-1 hover:bg-rose-500/20 rounded text-slate-400 hover:text-rose-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-300 truncate mb-1.5">
                    <HardDrive className="w-3 h-3 text-blue-400 shrink-0" />
                    <span className="truncate">s3://{p.bucket}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-mono">
                    {p.endpoint_url ? (
                      <span className="px-1.5 py-0.5 rounded bg-cyan-950/40 text-cyan-300 border border-cyan-800/40 truncate max-w-[170px]" title={p.endpoint_url}>
                        {p.endpoint_url}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-[#1a253c] text-slate-400 border border-[#233352]">
                        Default Endpoint
                      </span>
                    )}

                    {p.use_ssl === false ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                        verify=False
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                        SSL: True
                      </span>
                    )}
                  </div>

                  {testResult && testResult.id === p.id && (
                    <div className={`mt-2 p-1.5 rounded text-[10px] font-mono flex items-center gap-1.5 ${
                      testResult.success ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                    }`}>
                      {testResult.success ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 shrink-0" />}
                      <span className="truncate" title={testResult.message}>{testResult.message}</span>
                    </div>
                  )}
                </div>
              );
            })}

          {profiles.length === 0 && (
            <div className="p-6 text-center text-slate-500 text-xs border border-dashed border-[#1f2b45] rounded-xl my-4">
              <Cloud className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <span>No S3 connections yet</span>
              <p className="text-[10px] text-slate-600 mt-1">Click "+ Add" to connect your storage.</p>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 2. CENTER STAGE: S3 FOLDER NAVIGATOR & OBJECTS */}
      {/* ============================================================== */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#090d16]">
        {/* Top Navigator Header */}
        <div className="p-3.5 border-b border-[#1b2640] bg-[#0c1220] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Go Up Directory Button */}
            <button
              onClick={handleGoUp}
              disabled={!currentPrefix}
              className="p-1.5 rounded-lg bg-[#141d33] border border-[#243354] hover:bg-[#1a2745] text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition-colors shrink-0"
              title="Go up one folder"
            >
              <ArrowUp className="w-4 h-4" />
            </button>

            {/* Interactive Clickable Breadcrumbs */}
            <div className="flex items-center gap-1.5 bg-[#070b13] border border-[#1d2943] rounded-lg px-3 py-1.5 text-xs font-mono text-slate-300 overflow-x-auto flex-1">
              <span
                onClick={() => handleBreadcrumbClick(-1, [])}
                className="cursor-pointer hover:text-blue-400 text-amber-400 font-bold shrink-0 flex items-center gap-1"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>s3://{activeProfile?.bucket || 'select-bucket'}</span>
              </span>
              <span className="text-slate-600">/</span>

              {breadcrumbParts.map((part, idx) => (
                <React.Fragment key={idx}>
                  <span
                    onClick={() => handleBreadcrumbClick(idx, breadcrumbParts)}
                    className="cursor-pointer hover:text-blue-400 hover:underline shrink-0 text-slate-200"
                  >
                    {part}
                  </span>
                  <span className="text-slate-600">/</span>
                </React.Fragment>
              ))}
            </div>

            {/* Refresh Current Directory */}
            <button
              onClick={() => {
                if (selectedProfileId) handleBrowseFolder(selectedProfileId, currentPrefix);
              }}
              disabled={loadingBrowse}
              className="p-2 rounded-lg bg-[#141d33] border border-[#243354] hover:bg-[#1a2745] text-slate-300 transition-colors shrink-0"
              title="Refresh Folder"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loadingBrowse ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Quick Action: Live Preview Button */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handlePreview}
              disabled={loadingPreview || !activeProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#16223b] hover:bg-[#1d2d4f] border border-[#27385d] text-sky-300 text-xs font-semibold shadow-sm transition-all"
            >
              <Eye className="w-3.5 h-3.5 text-sky-400" />
              <span>{loadingPreview ? 'Scanning...' : 'Live Preview'}</span>
            </button>
          </div>
        </div>

        {/* Directory Stats Bar */}
        {browseData && (
          <div className="px-4 py-2 border-b border-[#162033] bg-[#0b0f1b] flex items-center justify-between text-[11px] font-mono text-slate-400">
            <div className="flex items-center gap-4">
              <span>Subfolders: <b className="text-slate-200">{browseData.subfolders.length}</b></span>
              <span>Files: <b className="text-slate-200">{browseData.total_files_in_folder}</b></span>
              <span>Total Size: <b className="text-emerald-400">{browseData.total_bytes_formatted}</b></span>
              {browseData.is_partitioned && (
                <span className="flex items-center gap-1 text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded font-semibold text-[10px]">
                  <Sparkles className="w-3 h-3" />
                  <span>Hive Partitioning Detected</span>
                </span>
              )}
            </div>
            <div className="w-48">
              <input
                type="text"
                placeholder="Search in folder..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full bg-[#080d16] border border-[#1e2a42] rounded px-2 py-0.5 text-xs text-slate-200 outline-none placeholder-slate-600 font-mono"
              />
            </div>
          </div>
        )}

        {/* Error Banner */}
        {browseError && (
          <div className="m-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400 mt-0.5" />
            <div>
              <div className="font-bold mb-1">S3 Browse Failure</div>
              <p className="font-mono text-[11px] leading-relaxed whitespace-pre-line">{browseError}</p>
            </div>
          </div>
        )}

        {/* Subfolders Grid & Files Table */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Subfolders Section */}
          {filteredSubfolders.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 text-amber-400" />
                <span>Folders ({filteredSubfolders.length})</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
                {filteredSubfolders.map((sf) => (
                  <div
                    key={sf}
                    onClick={() => handleFolderClick(sf)}
                    className="p-3 rounded-xl bg-[#0f1628] border border-[#1c2944] hover:border-amber-500/50 hover:bg-[#141e36] transition-all cursor-pointer flex items-center gap-2.5 text-xs font-mono text-slate-200 shadow-sm"
                  >
                    <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="truncate flex-1 font-semibold">{sf}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files Section */}
          {filteredFiles.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-400" />
                <span>Files in Folder ({filteredFiles.length})</span>
              </div>
              <div className="rounded-xl border border-[#1b2640] overflow-hidden bg-[#0c1220]">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#101729] border-b border-[#1b2640] text-slate-400">
                    <tr>
                      <th className="py-2.5 px-3">FILE NAME</th>
                      <th className="py-2.5 px-3 text-right">SIZE</th>
                      <th className="py-2.5 px-3">LAST MODIFIED</th>
                      <th className="py-2.5 px-3 text-right">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#151f35]">
                    {filteredFiles.map((file) => (
                      <tr key={file.key} className="hover:bg-[#11192e] transition-colors">
                        <td className="py-2 px-3 flex items-center gap-2">
                          <FileCode className={`w-3.5 h-3.5 ${file.is_parquet ? 'text-emerald-400' : 'text-slate-400'}`} />
                          <span className="text-slate-200 font-semibold">{file.name}</span>
                          {file.is_parquet && (
                            <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.2 rounded font-bold">
                              PARQUET
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-400 font-semibold">{file.size_formatted}</td>
                        <td className="py-2 px-3 text-slate-500 text-[11px]">
                          {new Date(file.last_modified).toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={handlePreview}
                            className="text-xs text-sky-400 hover:text-sky-300 font-sans font-medium"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty Folder State */}
          {!loadingBrowse && filteredSubfolders.length === 0 && filteredFiles.length === 0 && (
            <div className="p-12 text-center text-slate-500 text-xs border border-dashed border-[#1a253c] rounded-2xl flex flex-col items-center justify-center">
              <FolderPlus className="w-10 h-10 text-slate-600 mb-2" />
              <span className="font-semibold text-slate-400">This S3 folder is empty</span>
              <p className="text-[11px] text-slate-600 mt-1">No subfolders or parquet files found under this prefix.</p>
            </div>
          )}
        </div>

        {/* ============================================================== */}
        {/* 3. BOTTOM PANEL: LIVE ZERO-COPY PREVIEW & INGESTION */}
        {/* ============================================================== */}
        {previewOpen && (
          <div className="border-t border-[#1e2a42] bg-[#0b101c] flex flex-col max-h-[45vh] shrink-0">
            {/* Preview Toolbar */}
            <div className="p-3 border-b border-[#182338] bg-[#0d1424] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-sky-400" />
                  <span>Live Arrow Preview</span>
                  {previewLatency !== null && (
                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                      {previewLatency}ms Zero-Copy
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  Rows: {previewRows.length} | Columns: {previewCols.length}
                </span>
              </div>

              {/* Ingestion Inputs & Register Button */}
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer font-sans select-none">
                  <input
                    type="checkbox"
                    checked={recursiveGlob}
                    onChange={(e) => setRecursiveGlob(e.target.checked)}
                    className="w-3.5 h-3.5 rounded bg-[#162035] text-blue-600 cursor-pointer"
                  />
                  <span>Recursive Glob</span>
                </label>

                <div className="flex items-center gap-1.5 font-mono text-xs">
                  <span className="text-slate-400 text-[11px]">Dataset ID:</span>
                  <input
                    type="text"
                    value={targetDatasetId}
                    onChange={(e) => setTargetDatasetId(e.target.value)}
                    placeholder="s3_dataset_name"
                    className="bg-[#080d17] border border-[#202e49] rounded px-2 py-1 text-slate-200 outline-none w-44"
                  />
                </div>

                {/* Primary Action 1: Download & Ingest to Local (Recommended) */}
                <button
                  onClick={handleDownloadAndIngest}
                  disabled={downloading || registering || !targetDatasetId.trim()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md shadow-blue-950/40 disabled:opacity-50"
                  title="Download Parquet files via Boto3 to local disk for 0ms latency and 100% offline access"
                >
                  {downloading ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span>Download & Ingest Local</span>
                </button>

                {/* Primary Action 2: Zero-Copy Remote Stream */}
                <button
                  onClick={handleRegisterAndOpen}
                  disabled={registering || downloading || !targetDatasetId.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#16223b] hover:bg-[#1d2d4f] border border-[#27385d] text-emerald-300 text-xs font-bold transition-all shadow-sm disabled:opacity-50"
                  title="Query directly over S3 range requests without downloading files"
                >
                  {registering ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-emerald-400" />}
                  <span>Remote Stream (Zero-Copy)</span>
                </button>

                <button
                  onClick={() => setPreviewOpen(false)}
                  className="p-1 hover:bg-[#1a253c] rounded text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Action Status Notice */}
            {actionStatus && (
              <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/30 text-blue-300 text-xs flex items-center gap-2 font-mono">
                <RotateCw className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
                <span>{actionStatus}</span>
              </div>
            )}

            {/* Error Banner */}
            {previewError && (
              <div className="p-3 bg-rose-500/10 border-b border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{previewError}</span>
              </div>
            )}

            {/* Schema Badges */}
            {previewCols.length > 0 && (
              <div className="px-3 py-1.5 border-b border-[#162033] bg-[#090e18] flex items-center gap-1.5 overflow-x-auto text-[10px] font-mono">
                <span className="text-slate-500 uppercase font-semibold">Schema:</span>
                {previewCols.map((col) => (
                  <span key={col} className="px-1.5 py-0.5 rounded bg-[#131b2e] border border-[#1f2b45] text-slate-300 shrink-0">
                    <span className="text-slate-400 font-semibold">{col}</span>
                    {previewColTypes[col] && (
                      <span className="text-blue-400 text-[9px] ml-1">({previewColTypes[col]})</span>
                    )}
                  </span>
                ))}
              </div>
            )}

            {/* Live Data Table */}
            <div className="flex-1 overflow-auto p-2">
              {loadingPreview ? (
                <div className="p-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                  <RotateCw className="w-4 h-4 animate-spin text-sky-400" />
                  <span>Streaming sample rows from S3...</span>
                </div>
              ) : previewRows.length > 0 ? (
                <div className="border border-[#1a253d] rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#121a2c] text-slate-300 border-b border-[#1e2a44] sticky top-0">
                      <tr>
                        {previewCols.map((col) => (
                          <th key={col} className="py-1.5 px-2.5 truncate max-w-[150px]">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#151f33] bg-[#090d16]">
                      {previewRows.slice(0, 15).map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-[#0f1729]">
                          {previewCols.map((col) => (
                            <td key={col} className="py-1 px-2.5 truncate max-w-[180px] text-slate-300 text-[11px]">
                              {row[col] !== null && row[col] !== undefined ? String(row[col]) : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center text-slate-500 text-xs">
                  No preview records available. Click "Live Preview" to inspect data.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* 4. INLINE MODAL / DRAWER: ADD / EDIT S3 CONNECTION */}
      {/* ============================================================== */}
      {isEditingConnection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <form
            onSubmit={handleSaveConnection}
            className="w-full max-w-lg bg-[#0e1526] border border-blue-500/40 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 text-xs font-mono"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#1c2944]">
              <div className="flex items-center gap-2 text-blue-400 font-bold text-sm">
                <ShieldCheck className="w-5 h-5 text-blue-400" />
                <span>{editingProfileId ? 'Edit S3 Connection' : 'New S3 Connection'}</span>
              </div>
              <button
                type="button"
                onClick={() => setIsEditingConnection(false)}
                className="p-1 hover:bg-[#1a253c] rounded text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-slate-400 font-semibold block mb-1">Connection Name *</label>
                <input
                  type="text"
                  placeholder="e.g. On-Prem MinIO"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full bg-[#080d17] border border-[#202e49] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-slate-400 font-semibold block mb-1">Bucket Name *</label>
                <input
                  type="text"
                  placeholder="e.g. market-data"
                  value={bucketName}
                  onChange={(e) => setBucketName(e.target.value)}
                  className="w-full bg-[#080d17] border border-[#202e49] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div className="col-span-2">
                <label className="text-slate-400 font-semibold block mb-1">Endpoint URL (Host & Port)</label>
                <input
                  type="text"
                  placeholder="e.g. https://192.168.1.100:9000 or http://localhost:9000"
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  className="w-full bg-[#080d17] border border-[#202e49] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-slate-400 font-semibold block mb-1">Access Key ID</label>
                <input
                  type="text"
                  placeholder="Username / Key ID"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  className="w-full bg-[#080d17] border border-[#202e49] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-slate-400 font-semibold block mb-1">Secret Access Key</label>
                <input
                  type="password"
                  placeholder={editingProfileId ? 'Leave blank to preserve...' : 'Password / Secret Key'}
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  className="w-full bg-[#080d17] border border-[#202e49] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                />
              </div>

              {/* SSL Verification Toggle */}
              <div className="col-span-2 flex items-center justify-between p-3 rounded-lg bg-[#080d17] border border-[#202e49]">
                <div className="flex flex-col">
                  <span className="text-slate-200 font-semibold text-xs flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                    SSL Verification (verify)
                  </span>
                  <span className="text-[11px] text-slate-400 font-sans mt-0.5">
                    Mark <b>False</b> for self-signed HTTPS certificates (<code className="text-sky-300">verify=False</code>) or plain HTTP on-prem clusters.
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={useSsl}
                    onChange={(e) => setUseSsl(e.target.checked)}
                    className="w-4 h-4 rounded bg-[#162035] text-blue-600 focus:ring-0 cursor-pointer"
                  />
                  <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${
                    useSsl ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  }`}>
                    {useSsl ? 'SSL: True (Verified)' : 'SSL: False (verify=False)'}
                  </span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#1c2944]">
              <button
                type="button"
                onClick={() => setIsEditingConnection(false)}
                className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingProfile}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md flex items-center gap-1.5 disabled:opacity-50"
              >
                {savingProfile && <RotateCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{editingProfileId ? 'Update Connection' : 'Save Connection'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
