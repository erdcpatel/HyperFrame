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
  X,
  RotateCw,
  HardDrive,
  Layers,
  Eye,
  Key,
  ShieldCheck,
  Search,
  ExternalLink,
  ArrowLeft,
  Edit2
} from 'lucide-react';
import { S3ProfilePublic, S3BrowseResponse, DatasetWeather } from '../../types';
import {
  fetchS3Profiles,
  saveS3Profile,
  deleteS3Profile,
  testS3Connection,
  browseS3Folder,
  previewS3Data,
  registerS3Dataset
} from '../../services/api';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onDatasetRegistered: (weather: DatasetWeather) => void;
}

const AWS_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'ap-southeast-1',
  'ap-northeast-1',
  'sa-east-1'
];

export const S3ManagerModal: React.FC<Props> = ({ isOpen, onClose, onDatasetRegistered }) => {
  const [activeTab, setActiveTab] = useState<'profiles' | 'browser' | 'preview'>('profiles');

  // Profiles State
  const [profiles, setProfiles] = useState<S3ProfilePublic[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; latency?: number; message: string } | null>(null);

  // New/Edit Profile Form State
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [bucketName, setBucketName] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [useSsl, setUseSsl] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  // Browser State
  const [currentPrefix, setCurrentPrefix] = useState('');
  const [browseData, setBrowseData] = useState<S3BrowseResponse | null>(null);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  // Preview & Register State
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [previewCols, setPreviewCols] = useState<string[]>([]);
  const [previewLatency, setPreviewLatency] = useState<number | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [targetDatasetId, setTargetDatasetId] = useState('');
  const [recursiveGlob, setRecursiveGlob] = useState(true);
  const [registering, setRegistering] = useState(false);

  // Load profiles on mount or open
  useEffect(() => {
    if (isOpen) {
      loadProfiles();
    }
  }, [isOpen]);

  const loadProfiles = async () => {
    try {
      const data = await fetchS3Profiles();
      setProfiles(data);
      if (data.length > 0 && !selectedProfileId) {
        setSelectedProfileId(data[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load profiles:', err);
    }
  };

  const handleTestProfile = async (id: string) => {
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

  const handleStartEdit = (p: S3ProfilePublic) => {
    setEditingProfileId(p.id);
    setProfileName(p.name);
    setBucketName(p.bucket);
    setRegion(p.region);
    setEndpointUrl(p.endpoint_url || '');
    setUseSsl(p.use_ssl !== false);
    setAccessKey(p.access_key_masked);
    setSecretKey('');
    setFormError(null);
    setIsAddingProfile(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileName.trim() || !bucketName.trim()) {
      setFormError('Please fill in Profile Name and S3 Bucket Name.');
      return;
    }
    setSavingProfile(true);
    setFormError(null);
    try {
      const id = editingProfileId || profileName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      await saveS3Profile({
        id,
        name: profileName,
        bucket: bucketName.trim(),
        region,
        access_key_id: accessKey.trim(),
        secret_access_key: secretKey.trim(),
        endpoint_url: endpointUrl.trim() || undefined,
        use_ssl: useSsl,
      });

      setIsAddingProfile(false);
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

  const handleDeleteProfile = async (id: string) => {
    if (!confirm('Are you sure you want to remove this S3 bucket profile?')) return;
    try {
      await deleteS3Profile(id);
      await loadProfiles();
      if (selectedProfileId === id) {
        setSelectedProfileId(profiles.find((p) => p.id !== id)?.id || '');
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // Browse Folder
  const loadFolder = async (prefix: string) => {
    if (!selectedProfileId) return;
    setLoadingBrowse(true);
    setBrowseError(null);
    try {
      const res = await browseS3Folder(selectedProfileId, prefix);
      setBrowseData(res);
      setCurrentPrefix(prefix);
    } catch (err: any) {
      setBrowseError(err.message || 'Failed to navigate S3 folder');
    } finally {
      setLoadingBrowse(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'browser' && selectedProfileId) {
      loadFolder(currentPrefix);
    }
  }, [activeTab, selectedProfileId]);

  const handleFolderClick = (subfolder: string) => {
    const nextPrefix = currentPrefix ? `${currentPrefix}${subfolder}/` : `${subfolder}/`;
    loadFolder(nextPrefix);
  };

  const handleBreadcrumbClick = (idx: number, parts: string[]) => {
    if (idx < 0) {
      loadFolder('');
      return;
    }
    const nextPrefix = parts.slice(0, idx + 1).join('/') + '/';
    loadFolder(nextPrefix);
  };

  // Preview & Register
  const handleOpenPreview = async () => {
    if (!selectedProfileId) return;
    setActiveTab('preview');
    setLoadingPreview(true);
    setPreviewError(null);

    // Auto-generate clean dataset ID
    const defaultDsId = (currentPrefix.replace(/\/$/, '').split('/').pop() || browseData?.bucket || 's3_lakehouse')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    setTargetDatasetId(`s3_${defaultDsId}`);

    try {
      const res = await previewS3Data({
        profile_id: selectedProfileId,
        folder_prefix: currentPrefix,
        recursive_glob: recursiveGlob,
        limit: 10,
      });
      setPreviewCols(res.columns || []);
      setPreviewRows(res.rows || []);
      setPreviewLatency(res.latency_ms);
    } catch (err: any) {
      setPreviewError(err.message || 'Failed to read S3 sample data via DuckDB httpfs');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleRegisterConfirm = async () => {
    if (!targetDatasetId.trim() || !selectedProfileId) return;
    setRegistering(true);
    try {
      const weather = await registerS3Dataset({
        dataset_id: targetDatasetId.trim(),
        profile_id: selectedProfileId,
        folder_prefix: currentPrefix,
        recursive_glob: recursiveGlob,
      });
      onDatasetRegistered(weather);
      onClose();
    } catch (err: any) {
      setPreviewError(err.message || 'Dataset registration failed');
    } finally {
      setRegistering(false);
    }
  };

  if (!isOpen) return null;

  const breadcrumbParts = currentPrefix.split('/').filter(Boolean);
  const activeProfile = profiles.find((p) => p.id === selectedProfileId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-4xl bg-[#0b101d] border border-[#1f2b45] rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#1b2640] bg-[#0e1424] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>S3 Lakehouse Storage Manager</span>
                <span className="text-[10px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-full font-semibold">
                  Zero-Copy Stream
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure multiple S3 bucket credentials, browse folders, and stream multi-file datasets directly without local downloads.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#1a233a] text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 border-b border-[#1b2640] bg-[#0c1220] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('profiles')}
              className={`px-4 py-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
                activeTab === 'profiles'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span>1. Bucket Configurations ({profiles.length})</span>
            </button>
            <button
              onClick={() => {
                if (profiles.length > 0) setActiveTab('browser');
              }}
              disabled={profiles.length === 0}
              className={`px-4 py-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
                activeTab === 'browser'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200 disabled:opacity-40'
              }`}
            >
              <Folder className="w-3.5 h-3.5" />
              <span>2. S3 Folder Navigator</span>
            </button>
            {activeTab === 'preview' && (
              <button
                className="px-4 py-3 text-xs font-semibold flex items-center gap-2 border-b-2 border-emerald-500 text-emerald-400"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>3. Live Preview & Register</span>
              </button>
            )}
          </div>

          {activeTab === 'browser' && activeProfile && (
            <div className="text-[11px] font-mono text-slate-400 flex items-center gap-2">
              <span>Active Bucket:</span>
              <span className="text-slate-200 font-semibold bg-[#151f33] px-2 py-0.5 rounded border border-[#24324f]">
                s3://{activeProfile.bucket}
              </span>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* TAB 1: BUCKET PROFILES */}
          {activeTab === 'profiles' && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Configured S3 Buckets</h3>
                  <p className="text-xs text-slate-400">Manage credentials and regions for your AWS S3 data lakes.</p>
                </div>
                {!isAddingProfile && (
                  <button
                    onClick={() => setIsAddingProfile(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all shadow-md shadow-blue-950/40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add S3 Bucket Profile</span>
                  </button>
                )}
              </div>

              {/* Add Profile Form */}
              {isAddingProfile && (
                <form onSubmit={handleSaveProfile} className="bg-[#0f172a] border border-blue-500/30 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
                  <div className="flex items-center justify-between pb-2 border-b border-[#1e293b]">
                    <div className="flex items-center gap-2 text-blue-400 font-semibold text-xs">
                      <ShieldCheck className="w-4 h-4" />
                      <span>{editingProfileId ? 'Edit S3 Bucket Configuration' : 'New S3 Bucket Configuration'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingProfile(false);
                        setEditingProfileId(null);
                      }}
                      className="text-slate-400 hover:text-slate-200 text-xs"
                    >
                      Cancel
                    </button>
                  </div>

                  {formError && (
                    <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{formError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                    <div>
                      <label className="text-slate-400 font-semibold block mb-1">Profile Name *</label>
                      <input
                        type="text"
                        placeholder="e.g. Production Lakehouse"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        className="w-full bg-[#0b101f] border border-[#24324f] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold block mb-1">S3 Bucket Name *</label>
                      <input
                        type="text"
                        placeholder="e.g. us-equities-archive-2026"
                        value={bucketName}
                        onChange={(e) => setBucketName(e.target.value)}
                        className="w-full bg-[#0b101f] border border-[#24324f] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold block mb-1">AWS Region *</label>
                      <select
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                        className="w-full bg-[#0b101f] border border-[#24324f] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500 cursor-pointer"
                      >
                        {AWS_REGIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold block mb-1">Custom Endpoint URL (Optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. localhost:9000, http://minio:9000"
                        value={endpointUrl}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEndpointUrl(val);
                          if (val.startsWith('http://')) {
                            setUseSsl(false);
                          } else if (val.startsWith('https://')) {
                            setUseSsl(true);
                          }
                        }}
                        className="w-full bg-[#0b101f] border border-[#24324f] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold block mb-1">AWS Access Key ID *</label>
                      <input
                        type="text"
                        placeholder="AKIA... (or leave blank for IAM Role)"
                        value={accessKey}
                        onChange={(e) => setAccessKey(e.target.value)}
                        className="w-full bg-[#0b101f] border border-[#24324f] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 font-semibold block mb-1">AWS Secret Access Key</label>
                      <input
                        type="password"
                        placeholder={editingProfileId ? 'Leave blank to preserve existing key...' : 'Secret key... (or leave blank for IAM)'}
                        value={secretKey}
                        onChange={(e) => setSecretKey(e.target.value)}
                        className="w-full bg-[#0b101f] border border-[#24324f] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* SSL / HTTPS Toggle */}
                    <div className="col-span-2 flex items-center justify-between p-3 rounded-lg bg-[#0b101f] border border-[#24324f]">
                      <div className="flex flex-col">
                        <span className="text-slate-200 font-semibold text-xs flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                          SSL / HTTPS Encryption
                        </span>
                        <span className="text-[11px] text-slate-400 font-sans">
                          Mark <b>False (Insecure HTTP)</b> for local MinIO / Ceph endpoints running on plain HTTP (e.g. <code className="text-amber-400">http://localhost:9000</code>).
                        </span>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={useSsl}
                          onChange={(e) => setUseSsl(e.target.checked)}
                          className="w-4 h-4 rounded bg-[#162035] border-[#24324f] text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded border ${
                          useSsl ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        }`}>
                          {useSsl ? 'SSL: True (HTTPS)' : 'SSL: False (HTTP)'}
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all shadow-md disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {savingProfile && <RotateCw className="w-3.5 h-3.5 animate-spin" />}
                      <span>{editingProfileId ? 'Update S3 Configuration' : 'Save S3 Configuration'}</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Profiles List */}
              <div className="grid grid-cols-1 gap-3">
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    className={`p-4 rounded-xl border transition-all flex items-center justify-between ${
                      selectedProfileId === p.id
                        ? 'bg-[#121a2f] border-blue-500/50 shadow-lg'
                        : 'bg-[#0e1424] border-[#1f2b45] hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
                        <HardDrive className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-slate-100">{p.name}</h4>
                          <span className="text-[10px] font-mono bg-[#162138] text-slate-300 px-2 py-0.5 rounded border border-[#24324f]">
                            s3://{p.bucket}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">({p.region})</span>
                          {p.use_ssl === false ? (
                            <span className="text-[9px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-semibold">
                              HTTP (SSL False)
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-semibold">
                              HTTPS
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono mt-1">
                          <span>Key: {p.access_key_masked}</span>
                          {testResult && testResult.id === p.id && (
                            <span
                              className={`flex items-center gap-1 ${
                                testResult.success ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {testResult.success ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                              <span>{testResult.message}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleStartEdit(p)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#162035] hover:bg-[#1d2a45] text-slate-300 border border-[#24324f] text-xs font-medium transition-colors flex items-center gap-1.5"
                        title="Edit bucket configuration, region, endpoint, or SSL"
                      >
                        <Edit2 className="w-3 h-3 text-sky-400" />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => handleTestProfile(p.id)}
                        disabled={testingId === p.id}
                        className="px-2.5 py-1.5 rounded-lg bg-[#162035] hover:bg-[#1d2a45] text-slate-300 border border-[#24324f] text-xs font-medium transition-colors flex items-center gap-1.5"
                      >
                        <RotateCw className={`w-3 h-3 ${testingId === p.id ? 'animate-spin' : ''}`} />
                        <span>Test</span>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedProfileId(p.id);
                          setActiveTab('browser');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-all flex items-center gap-1.5"
                      >
                        <Folder className="w-3.5 h-3.5" />
                        <span>Browse Bucket</span>
                      </button>
                      <button
                        onClick={() => handleDeleteProfile(p.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition-colors"
                        title="Delete Profile"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {profiles.length === 0 && !isAddingProfile && (
                  <div className="p-12 text-center text-slate-500 text-xs border border-dashed border-[#1f2b45] rounded-xl flex flex-col items-center justify-center">
                    <Cloud className="w-10 h-10 text-slate-600 mb-2" />
                    <span className="font-semibold text-slate-400">No S3 bucket configurations found</span>
                    <span className="mt-1">Add your AWS S3 bucket credentials above to connect your lakehouse.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: INTERACTIVE S3 FOLDER NAVIGATOR */}
          {activeTab === 'browser' && (
            <div className="flex flex-col gap-4">
              {/* Profile Selector & Breadcrumbs */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1 overflow-x-auto bg-[#090d16] border border-[#1f2b45] rounded-lg px-3 py-2 text-xs font-mono text-slate-300">
                  <span
                    onClick={() => handleBreadcrumbClick(-1, [])}
                    className="cursor-pointer hover:text-blue-400 text-slate-400 font-semibold shrink-0"
                  >
                    s3://{activeProfile?.bucket || 'bucket'}
                  </span>
                  <span className="text-slate-600">/</span>
                  {breadcrumbParts.map((part, idx) => (
                    <React.Fragment key={idx}>
                      <span
                        onClick={() => handleBreadcrumbClick(idx, breadcrumbParts)}
                        className="cursor-pointer hover:text-blue-400 text-slate-200 font-medium shrink-0"
                      >
                        {part}
                      </span>
                      <span className="text-slate-600">/</span>
                    </React.Fragment>
                  ))}
                </div>

                <button
                  onClick={() => loadFolder(currentPrefix)}
                  className="p-2 rounded-lg bg-[#141b2c] hover:bg-[#1a233a] border border-[#24324f] text-slate-300 transition-colors shrink-0"
                  title="Refresh Folder"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${loadingBrowse ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {browseError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{browseError}</span>
                </div>
              )}

              {/* Folder Summary Banner */}
              {browseData && (
                <div className="px-4 py-2.5 rounded-lg bg-[#0e1628] border border-[#1d2742] flex items-center justify-between text-xs font-mono text-slate-300">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-blue-400">
                      <Folder className="w-3.5 h-3.5" />
                      {browseData.subfolders.length} Subfolders
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="flex items-center gap-1.5 text-emerald-400">
                      <FileText className="w-3.5 h-3.5" />
                      {browseData.total_files_in_folder} Files ({browseData.total_bytes_formatted})
                    </span>
                    {browseData.is_partitioned && (
                      <span className="bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded text-[10px]">
                        Hive Partitions Detected
                      </span>
                    )}
                  </div>

                  {browseData.total_files_in_folder > 0 && (
                    <button
                      onClick={handleOpenPreview}
                      className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-all shadow-md shadow-blue-950/40 text-xs flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Select Folder as Dataset</span>
                    </button>
                  )}
                </div>
              )}

              {/* Items Table */}
              <div className="rounded-xl border border-[#1f2b45] bg-[#0c101d] overflow-hidden">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-[#101728] border-b border-[#1f2b45] text-slate-400">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">NAME</th>
                      <th className="py-2.5 px-4 font-semibold text-right">SIZE</th>
                      <th className="py-2.5 px-4 font-semibold text-right">LAST MODIFIED</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#172238]">
                    {/* Parent Folder Button if inside a prefix */}
                    {currentPrefix && (
                      <tr
                        onClick={() => {
                          const parts = currentPrefix.replace(/\/$/, '').split('/');
                          parts.pop();
                          loadFolder(parts.length ? parts.join('/') + '/' : '');
                        }}
                        className="hover:bg-[#121929] cursor-pointer transition-colors text-slate-400"
                      >
                        <td colSpan={3} className="py-2 px-4 flex items-center gap-2 font-semibold">
                          <ArrowLeft className="w-3.5 h-3.5 text-blue-400" />
                          <span>.. (Go Up One Folder)</span>
                        </td>
                      </tr>
                    )}

                    {/* Subfolders */}
                    {browseData?.subfolders.map((sf) => (
                      <tr
                        key={sf}
                        onClick={() => handleFolderClick(sf)}
                        className="hover:bg-[#121b30] cursor-pointer transition-colors group"
                      >
                        <td className="py-2 px-4 flex items-center gap-2 font-semibold text-slate-200">
                          <Folder className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                          <span className="group-hover:text-blue-300 transition-colors">{sf}/</span>
                        </td>
                        <td className="py-2 px-4 text-right text-slate-500">(Folder)</td>
                        <td className="py-2 px-4 text-right text-slate-500">—</td>
                      </tr>
                    ))}

                    {/* Files */}
                    {browseData?.files.map((file) => (
                      <tr key={file.key} className="hover:bg-[#101625] transition-colors">
                        <td className="py-2 px-4 flex items-center gap-2 text-slate-300">
                          <FileText className={`w-4 h-4 ${file.is_parquet ? 'text-blue-400' : 'text-slate-400'}`} />
                          <span className={file.is_parquet ? 'font-semibold text-slate-200' : ''}>{file.name}</span>
                        </td>
                        <td className="py-2 px-4 text-right text-slate-400">{file.size_formatted}</td>
                        <td className="py-2 px-4 text-right text-slate-500">
                          {new Date(file.last_modified).toLocaleString()}
                        </td>
                      </tr>
                    ))}

                    {browseData && browseData.subfolders.length === 0 && browseData.files.length === 0 && !loadingBrowse && (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-slate-500 text-xs">
                          This folder is empty or contains no recognized files.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: SAMPLE PREVIEW & REGISTRATION */}
          {activeTab === 'preview' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setActiveTab('browser')}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 font-semibold"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Folder Browser</span>
                </button>
                {previewLatency !== null && (
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    Byte-range scan: {previewLatency.toFixed(1)}ms
                  </span>
                )}
              </div>

              {previewError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{previewError}</span>
                </div>
              )}

              {/* Registration Settings */}
              <div className="p-4 rounded-xl bg-[#0e1628] border border-[#1f2b45] grid grid-cols-2 gap-4 text-xs font-mono">
                <div>
                  <label className="text-slate-400 font-semibold block mb-1">Dataset ID in HyperFrame *</label>
                  <input
                    type="text"
                    value={targetDatasetId}
                    onChange={(e) => setTargetDatasetId(e.target.value)}
                    className="w-full bg-[#0a0e1a] border border-[#24324f] rounded-lg p-2 text-slate-200 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-slate-400 font-semibold block mb-1">Multi-File Pattern</label>
                  <div className="flex items-center gap-4 mt-2">
                    <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        checked={recursiveGlob}
                        onChange={() => setRecursiveGlob(true)}
                        className="accent-blue-600"
                      />
                      <span>**/*.parquet (Include Subfolders)</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        checked={!recursiveGlob}
                        onChange={() => setRecursiveGlob(false)}
                        className="accent-blue-600"
                      />
                      <span>*.parquet (Flat Folder)</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Sample Table */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-slate-300">
                  Top 10 Sample Rows (Zero-download stream from S3):
                </span>
                <div className="rounded-xl border border-[#1f2b45] bg-[#0c101d] overflow-x-auto max-h-64">
                  {loadingPreview ? (
                    <div className="p-12 text-center text-slate-500 text-xs flex items-center justify-center gap-2">
                      <RotateCw className="w-4 h-4 animate-spin text-blue-400" />
                      <span>Scanning remote Parquet footers over HTTP...</span>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[#12192b] border-b border-[#1f2b45] text-slate-300 sticky top-0">
                        <tr>
                          {previewCols.map((col) => (
                            <th key={col} className="py-2 px-3 font-semibold text-slate-300 truncate">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#172238]">
                        {previewRows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-[#111726]">
                            {previewCols.map((col) => (
                              <td key={col} className="py-1.5 px-3 text-slate-300 truncate max-w-xs">
                                {String(row[col] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Confirm Registration Button */}
              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  onClick={handleRegisterConfirm}
                  disabled={registering || !targetDatasetId.trim()}
                  className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-lg shadow-emerald-950/40 flex items-center gap-2 disabled:opacity-50"
                >
                  {registering ? (
                    <RotateCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>Register S3 Folder as Unified Dataset</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
