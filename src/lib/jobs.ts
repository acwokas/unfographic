import { ConversionJob } from '@/types/layout';

const jobs = new Map<string, ConversionJob>();

export function createJob(file: File, imageDataUrl: string): ConversionJob {
  const id = crypto.randomUUID();
  const job: ConversionJob = {
    id,
    fileName: file.name,
    imageDataUrl,
    status: 'uploading',
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): ConversionJob | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, updates: Partial<ConversionJob>): ConversionJob | undefined {
  const job = jobs.get(id);
  if (job) {
    Object.assign(job, updates);
  }
  return job;
}
