/** Shared types for the YouTube Mass Research Engine (docs/YOUTUBE_RESEARCH.md). */

export type SourceKind = 'video' | 'playlist' | 'channel' | 'search' | 'file' | 'collection';

export interface ResolvedSource {
  kind: SourceKind;
  /** Canonical URL, search query, file path or collection name. */
  value: string;
  /** Video ids known up front (video, file, collection). */
  videoIds: string[];
}

export interface Chapter {
  title: string;
  startSeconds: number;
  endSeconds: number;
}

export interface VideoMetadata {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  channelId: string;
  description: string;
  publishedAt: string;
  durationSeconds: number;
  views: number;
  likes: number;
  tags: string[];
  chapters: Chapter[];
  thumbnailUrl: string;
  language: string;
  hasManualCaptions: boolean;
  hasAutoCaptions: boolean;
  retrievedAt: string;
}

export type TranscriptSource = 'MANUAL_CAPTION' | 'AUTO_CAPTION' | 'GENERATED_ASR';

export interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  source: TranscriptSource;
  language: string;
  segments: TranscriptSegment[];
  /** Untouched caption text, kept so normalization never overwrites the source. */
  rawText: string;
  retrievedAt: string;
}

export interface Chunk {
  chunkId: string;
  videoId: string;
  chapter?: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  tokenCount: number;
}

export type VideoStatus = 'PENDING' | 'READY' | 'NO_TRANSCRIPT' | 'TRANSCRIPTION_REQUIRED' | 'PRIVATE' | 'DELETED' | 'UNAVAILABLE' | 'PROCESSING_FAILED';

export type Route = 'deep' | 'focused' | 'index' | 'archive';

export interface VideoScreening {
  relevance: number;
  contentType: string;
  contentTypeConfidence: number;
  technicalDepth: number;
  actionability: number;
  novelty: number;
  promotionalIntensity: number;
  evidenceDensity: number;
  deepAnalysisRecommended: number;
  confidence: number;
  /** 0..1 research value computed by policy code. */
  researchValue: number;
  route: Route;
  reasonCodes: string[];
}

export interface ChunkScreening {
  chunkId: string;
  relevant: number;
  importance: number;
  containsActionableSteps: number;
  containsHardware: number;
  containsSoftware: number;
  containsCode: number;
  containsConfiguration: number;
  containsMeasurements: number;
  containsCostData: number;
  containsPerformanceClaims: number;
  containsDesignDecision: number;
  containsFailureOrWarning: number;
  confidence: number;
}

export interface VideoRecord {
  videoId: string;
  status: VideoStatus;
  title?: string;
  channelName?: string;
  durationSeconds?: number;
  transcriptSource?: TranscriptSource;
  transcriptChars?: number;
  chunkCount?: number;
  screening?: VideoScreening;
  chunkScreenings?: ChunkScreening[];
  deepAnalysisDone?: boolean;
  duplicateOf?: string;
  error?: string;
}

export type JobState = 'CREATED' | 'DISCOVERING' | 'INGESTING' | 'TRANSCRIBING' | 'CHUNKING' | 'SCREENING' | 'DEDUPLICATING' | 'ANALYZING' | 'SYNTHESIZING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';

export type ResearchMode = 'fast' | 'standard' | 'deep' | 'audit';
export type ResearchTask = 'research' | 'analyze' | 'compare' | 'parts' | 'steps';

export interface JobOptions {
  mode: ResearchMode;
  task: ResearchTask;
  maxVideos: number;
  top: number;
  analyzeAll: boolean;
  dedupe: boolean;
  budgetUsd: number;
  deepModel: string;
  collection?: string;
}

export interface JobMetrics {
  videosDiscovered: number;
  videosProcessed: number;
  videosRejected: number;
  transcriptTokens: number;
  jevCalls: number;
  deepModelCalls: number;
  visionCalls: number;
  duplicateClusters: number;
  claimsExtracted: number;
  processingErrors: number;
  estimatedCostUsd: number;
}

export interface ResearchJob {
  jobId: string;
  question: string;
  sources: ResolvedSource[];
  options: JobOptions;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  videoOrder: string[];
  videos: Record<string, VideoRecord>;
  metrics: JobMetrics;
  reportPath?: string;
  bundlePath?: string;
  error?: string;
}

export interface Citation {
  sourceType: 'youtube';
  videoId: string;
  title: string;
  channel: string;
  timestampStart: number;
  timestampEnd: number;
  chunkId: string;
  url: string;
}

export interface CostEstimate {
  videos: number;
  transcriptTokens: number;
  jevCalls: number;
  jevCostUsd: number;
  deepCandidates: number;
  deepInputTokens: number;
  deepCostUsd: number | null;
  totalCostUsd: number;
  isEstimate: true;
}
