import { Composition, registerRoot } from 'remotion';
import { MasterComposition, getProjectDuration } from './index';
import type { MasterCompositionProps } from './index';

const Root = () => <Composition id="YouTubeStudio" component={MasterComposition} width={1920} height={1080} fps={30} durationInFrames={30}
  defaultProps={{ project: { id: '', title: '', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', automationMode: 'assisted', settings: { category: 'Technology', provider: 'offline', model: '', temperature: 0.7, maxTokens: 4096 }, createdAt: '', updatedAt: '', sections: [] }, tracks: [], clips: [], assets: [] } as MasterCompositionProps}
  calculateMetadata={({ props }) => ({ width: props.project.width, height: props.project.height, fps: props.project.fps, durationInFrames: getProjectDuration(props.project, props.clips) })} />;
registerRoot(Root);
