import {
  BaseTool,
  drawing,
  Enums as csToolsEnums,
  segmentation as cstSegmentation,
} from '@cornerstonejs/tools';
import { cache, eventTarget, utilities as csUtils, getEnabledElement } from '@cornerstonejs/core';
import { runReassignVoronoi2D } from './algorithms/regionGrow';

const { triggerSegmentationEvents } = cstSegmentation;
const { Labelmap: LABELMAP } = csToolsEnums.SegmentationRepresentations;

const { transformWorldToIndex } = csUtils;

type TraceSet = {
  sliceKey: string;
  positive: [number, number, number][][];
  negative: [number, number, number][][];
};

class ReassignTool extends BaseTool {
  static toolName = 'ReassignTool';
  static sharedServicesManager: any = null;

  isDrawing = false;
  activeTrace: [number, number, number][] = [];
  activeTraceType: 'positive' | 'negative' | null = null;
  activeTraceSliceKey: string | null = null;
  traceSet: TraceSet | null = null;

  // Undo stack for segmentations
  segmentUndoStack: {
    segmentationId: string;
    sliceAxis: number;
    sliceIndex: number;
    originalValues: Int16Array;
  }[] = [];

  // Current draw mode: 'include' (positive) or 'exclude' (negative)
  drawMode: 'include' | 'exclude' = 'include';

  // Keyboard listener flag
  keyListenerAdded = false;
  // Services manager reference
  servicesManager: any = null;

  constructor(toolProps = {}, defaultToolProps = {
    supportedInteractionTypes: ['Mouse', 'Touch'],
    configuration: {},
  }) {
    super(toolProps, defaultToolProps);
  }

  setDrawMode(mode: 'include' | 'exclude') {
    this.drawMode = mode;
  }

  clearTraces() {
    this.traceSet = null;
    this.activeTrace = [];
    this.activeTraceSliceKey = null;
    this.isDrawing = false;
    this.activeTraceType = null;
  }

  undoChange(servicesManager: any) {
    const sm = servicesManager ?? this.servicesManager ?? ReassignTool.sharedServicesManager;
    if (this.segmentUndoStack.length === 0) {
      console.log('Undo stack is empty');
      return;
    }
    const lastChange = this.segmentUndoStack.pop();
    const { segmentationId, sliceAxis, sliceIndex, originalValues } = lastChange;

    const segmentation = cstSegmentation.state.getSegmentation(segmentationId);
    if (!segmentation) return;

    const labelmapData = segmentation.representationData.Labelmap;
    if (!labelmapData || !labelmapData.volumeId) return;

    const labelmapVolume = cache.getVolume(labelmapData.volumeId);
    if (!labelmapVolume) return;

    const scalarData = this.getScalarData(labelmapVolume);
    if (!scalarData) return;
    const dimensions = labelmapVolume.dimensions;
    const [X, Y, Z] = dimensions;

    // Determine 2D dimensions
    let W = 0, H = 0;
    if (sliceAxis === 0) {
      W = dimensions[1];
      H = dimensions[2];
    } else if (sliceAxis === 1) {
      W = dimensions[0];
      H = dimensions[2];
    } else {
      W = dimensions[0];
      H = dimensions[1];
    }

    // Restore original values
    let idx2d = 0;
    for (let v = 0; v < H; v++) {
      for (let u = 0; u < W; u++) {
        let i = 0, j = 0, k = 0;
        if (sliceAxis === 0) {
          i = sliceIndex; j = u; k = v;
        } else if (sliceAxis === 1) {
          i = u; j = sliceIndex; k = v;
        } else {
          i = u; j = v; k = sliceIndex;
        }
        const scalarIdx = i + j * X + k * X * Y;
        scalarData[scalarIdx] = originalValues[idx2d++];
      }
    }

    this.commitScalarData(labelmapVolume, scalarData);
    const { viewportGridService, cornerstoneViewportService } = sm.services;
    const viewportId = viewportGridService.getActiveViewportId();
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
    this.notifySegmentationModified(sm, viewport, viewportId, segmentationId);
  }

  onSetToolActive = () => {
    this.addKeyListener();
  };

  onSetToolPassive = () => {
    this.clearTraces();
    this.removeKeyListener();
  };

  onSetToolDisabled = () => {
    this.clearTraces();
    this.removeKeyListener();
  };

  addKeyListener() {
    if (this.keyListenerAdded) return;
    window.addEventListener('keydown', this.keydownHandler, true);
    this.keyListenerAdded = true;
  }

  removeKeyListener() {
    if (!this.keyListenerAdded) return;
    window.removeEventListener('keydown', this.keydownHandler, true);
    this.keyListenerAdded = false;
  }

  keydownHandler = (evt: KeyboardEvent) => {
    if (evt.key === 'Escape') {
      this.clearTraces();
      const sm = this.servicesManager ?? ReassignTool.sharedServicesManager;
      if (sm) {
        const { viewportGridService, cornerstoneViewportService } = sm.services;
        const viewportId = viewportGridService.getActiveViewportId();
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
        if (viewport) {
          viewport.render();
        }
      }
    }
  };

  updateToolbarOption(mode: 'include' | 'exclude') {
    this.setDrawMode(mode);
    const sm = this.servicesManager ?? ReassignTool.sharedServicesManager;
    if (sm) {
      const { toolbarService, viewportGridService } = sm.services;
      const button = toolbarService.getButton('ReassignTool');
      if (button) {
        const options = button.props.options?.map(option =>
          option.id === 'reassign-mode' ? { ...option, value: mode } : option
        );
        if (options) {
          toolbarService.setButtons({
            ...toolbarService.getButtons(),
            ReassignTool: {
              ...button,
              props: {
                ...button.props,
                options,
              },
            },
          });
          toolbarService.refreshToolbarState({
            viewportId: viewportGridService.getActiveViewportId(),
          });
        }
      }
    }
  }

  preMouseDownCallback = (evt: any): boolean => {
    if (!this.keyListenerAdded) {
      this.addKeyListener();
    }
    const eventDetail = evt.detail;
    const { currentPoints, element } = eventDetail;
    const enabledElement = getEnabledElement(element);
    const sliceKey = enabledElement
      ? this.getViewportSliceKey(enabledElement.viewport, currentPoints.world)
      : null;

    if (sliceKey && this.traceSet?.sliceKey !== sliceKey) {
      this.clearTraces();
    }
    if (sliceKey && !this.traceSet) {
      this.traceSet = {
        sliceKey,
        positive: [],
        negative: [],
      };
    }

    this.isDrawing = true;
    this.activeTraceType = this.drawMode === 'include' ? 'positive' : 'negative';
    this.activeTraceSliceKey = sliceKey;
    this.activeTrace = [currentPoints.world];

    return true; // Consume event
  };

  mouseDragCallback = (evt: any): void => {
    if (!this.isDrawing) return;
    const { currentPoints, element } = evt.detail;
    const enabledElement = getEnabledElement(element);
    if (!enabledElement) return;
    this.activeTrace.push(currentPoints.world);
    enabledElement.viewport.render();
  };

  mouseUpCallback = (evt: any): void => {
    if (!this.isDrawing) return;
    const { currentPoints, element } = evt.detail;
    const enabledElement = getEnabledElement(element);
    if (!enabledElement) return;
    this.activeTrace.push(currentPoints.world);

    if (this.activeTraceType === 'positive') {
      this.getOrCreateTraceSet(enabledElement.viewport).positive.push(this.activeTrace);
    } else {
      this.getOrCreateTraceSet(enabledElement.viewport).negative.push(this.activeTrace);
    }

    this.isDrawing = false;
    this.activeTrace = [];
    this.activeTraceSliceKey = null;
    this.activeTraceType = null;

    void this.runPlaceholderAlgorithm(enabledElement);
    enabledElement.viewport.render();
  };

  renderAnnotation = (enabledElement: any, svgDrawingHelper: any): void => {
    const { viewport } = enabledElement;
    const annotationUID = 'reassign-traces-annotation';
    const sliceKey = this.getViewportSliceKey(viewport);
    const visibleTraceSet = this.traceSet?.sliceKey === sliceKey ? this.traceSet : null;

    // Draw completed positive traces
    visibleTraceSet?.positive.forEach((trace, idx) => {
      const canvasCoords = trace.map(p => viewport.worldToCanvas(p));
      drawing.drawPolyline(
        svgDrawingHelper,
        annotationUID,
        `pos-${idx}`,
        canvasCoords,
        { color: 'rgb(0, 255, 0)', lineWidth: 2 }
      );
    });

    // Draw completed negative traces
    visibleTraceSet?.negative.forEach((trace, idx) => {
      const canvasCoords = trace.map(p => viewport.worldToCanvas(p));
      drawing.drawPolyline(
        svgDrawingHelper,
        annotationUID,
        `neg-${idx}`,
        canvasCoords,
        { color: 'rgb(255, 0, 0)', lineWidth: 2 }
      );
    });

    // Draw current active trace
    if (this.isDrawing && this.activeTrace.length > 1 && this.activeTraceSliceKey === sliceKey) {
      const canvasCoords = this.activeTrace.map(p => viewport.worldToCanvas(p));
      const color = this.activeTraceType === 'positive' ? 'rgb(0, 255, 0)' : 'rgb(255, 0, 0)';
      drawing.drawPolyline(
        svgDrawingHelper,
        annotationUID,
        'active',
        canvasCoords,
        { color, lineWidth: 2 }
      );
    }
  };

  async runPlaceholderAlgorithm(enabledElement: any) {
    if (!this.traceSet || (this.traceSet.positive.length === 0 && this.traceSet.negative.length === 0)) {
      return;
    }

    const sm = this.servicesManager ?? ReassignTool.sharedServicesManager;
    if (!sm) return;
    const { segmentationService } = sm.services;
    const { viewport } = enabledElement;
    const viewportId = viewport.id;
    const currentSliceKey = this.getViewportSliceKey(viewport);
    const activeTraceSet = this.traceSet?.sliceKey === currentSliceKey ? this.traceSet : null;
    const positiveTraces = activeTraceSet?.positive ?? [];
    const negativeTraces = activeTraceSet?.negative ?? [];

    if (positiveTraces.length === 0 && negativeTraces.length === 0) {
      return;
    }

    const activeSeg = segmentationService.getActiveSegmentation(viewportId);
    const activeSegIndexInfo = segmentationService.getActiveSegment(viewportId);
    if (!activeSeg || !activeSegIndexInfo) return;

    const { segmentationId } = activeSeg;
    const { segmentIndex } = activeSegIndexInfo;

    const editData = this.getLabelmapEditData(segmentationService, activeSeg, segmentationId, viewport);
    if (!editData) return;

    const { target: labelmapTarget, scalarData, dimensions, imageData, forceSliceInfo } = editData;
    const [X, Y] = dimensions;

    // Convert world points to rounded 3D voxel indices [i, j, k].
    // Cornerstone can return fractional index coordinates for world points.
    const posVoxelPoints = positiveTraces.flatMap(trace =>
      trace.map(p => this.worldToRoundedIjk(imageData, p))
    );
    const negVoxelPoints = negativeTraces.flatMap(trace =>
      trace.map(p => this.worldToRoundedIjk(imageData, p))
    );

    // Combine voxel points to find slice orientation
    const allPoints = [...posVoxelPoints, ...negVoxelPoints];
    const sliceInfo = forceSliceInfo ?? this.getSliceInfo(allPoints);
    if (!sliceInfo) return;

    const { sliceAxis, sliceIndex } = sliceInfo;

    // Define 2D slice grid boundaries
    let W = 0, H = 0;
    if (sliceAxis === 0) {
      W = dimensions[1];
      H = dimensions[2];
    } else if (sliceAxis === 1) {
      W = dimensions[0];
      H = dimensions[2];
    } else {
      W = dimensions[0];
      H = dimensions[1];
    }

    // Interpolate points using Bresenham to make continuous lines of seeds on the grid
    const posSeedsGrid: [number, number][] = [];
    positiveTraces.forEach(trace => {
      const uvs = trace.map(p => this.ijkToUv(this.worldToRoundedIjk(imageData, p), sliceAxis));
      for (let i = 0; i < uvs.length - 1; i++) {
        posSeedsGrid.push(...this.getLinePoints(uvs[i][0], uvs[i][1], uvs[i + 1][0], uvs[i + 1][1]));
      }
    });

    const negSeedsGrid: [number, number][] = [];
    negativeTraces.forEach(trace => {
      const uvs = trace.map(p => this.ijkToUv(this.worldToRoundedIjk(imageData, p), sliceAxis));
      for (let i = 0; i < uvs.length - 1; i++) {
        negSeedsGrid.push(...this.getLinePoints(uvs[i][0], uvs[i][1], uvs[i + 1][0], uvs[i + 1][1]));
      }
    });

    if (!posSeedsGrid.length && !negSeedsGrid.length) {
      return;
    }

    const intensityData = this.getViewportIntensityData(viewport);

    // Backup current slice voxel values for Undo support
    const backupArray = new Int16Array(W * H);
    let idx2d = 0;
    for (let v = 0; v < H; v++) {
      for (let u = 0; u < W; u++) {
        const ijk = this.uvToIjk(u, v, sliceAxis, sliceIndex);
        const idx = ijk[0] + ijk[1] * X + ijk[2] * X * Y;
        backupArray[idx2d++] = scalarData[idx];
      }
    }
    this.segmentUndoStack.push({
      segmentationId,
      sliceAxis,
      sliceIndex,
      originalValues: backupArray,
    });

    try {
      await runReassignVoronoi2D({
        scalarData,
        intensityData: intensityData?.scalarData,
        intensityDimensions: intensityData?.dimensions,
        dimensions,
        sliceAxis,
        sliceIndex,
        posSeedsGrid,
        negSeedsGrid,
        segmentIndex,
      });
    } catch (error) {
      console.error('Reassign region-grow WASM algorithm failed', error);
      return;
    }

    this.commitScalarData(labelmapTarget, scalarData);
    this.notifySegmentationModified(sm, viewport, viewportId, segmentationId);
  }

  getScalarData(labelmapVolume: any) {
    return (
      labelmapVolume.getScalarData?.() ??
      labelmapVolume.voxelManager?.getScalarData?.() ??
      labelmapVolume.voxelManager?.getCompleteScalarDataArray?.() ??
      labelmapVolume.getPixelData?.()
    );
  }

  getViewportIntensityData(viewport: any) {
    const viewportImageData = viewport.getImageData?.();
    const imageData = viewportImageData?.imageData ?? viewportImageData;
    const vtkScalars = imageData?.getPointData?.()?.getScalars?.()?.getData?.();
    const scalarData =
      viewportImageData?.scalarData ??
      imageData?.scalarData ??
      vtkScalars ??
      this.getScalarData(imageData);

    const vtkDimensions = imageData?.getDimensions?.();
    const dimensions =
      viewportImageData?.dimensions ??
      imageData?.dimensions ??
      (vtkDimensions ? [vtkDimensions[0], vtkDimensions[1], vtkDimensions[2] ?? 1] : null);

    if (scalarData && dimensions) {
      return { scalarData, dimensions };
    }

    const currentImageId = viewport.getCurrentImageId?.();
    const image = currentImageId ? cache.getImage(currentImageId) : null;
    const imageScalarData = image ? this.getScalarData(image) : null;
    const columns = image?.columns ?? image?.width;
    const rows = image?.rows ?? image?.height;
    if (imageScalarData && columns && rows) {
      return { scalarData: imageScalarData, dimensions: [columns, rows, 1] };
    }

    return null;
  }

  getViewportSliceKey(viewport: any, worldPoint?: [number, number, number]) {
    const imageId = viewport.getCurrentImageId?.();
    if (imageId) {
      return `image:${imageId}`;
    }

    const imageIdIndex = viewport.getCurrentImageIdIndex?.();
    if (imageIdIndex !== undefined && imageIdIndex !== null) {
      return `imageIndex:${imageIdIndex}`;
    }

    const viewReference = viewport.getViewReference?.();
    if (viewReference?.sliceIndex !== undefined) {
      const normal = viewReference.viewPlaneNormal?.map(v => Number(v).toFixed(3)).join(',');
      return `viewRef:${normal ?? 'unknown'}:${viewReference.sliceIndex}`;
    }

    const camera = viewport.getCamera?.();
    const normal = camera?.viewPlaneNormal;
    const focalPoint = worldPoint ?? camera?.focalPoint;
    if (normal && focalPoint) {
      const roundedNormal = normal.map(v => Number(v).toFixed(3)).join(',');
      const planeOffset = normal
        .reduce((sum, value, index) => sum + value * focalPoint[index], 0)
        .toFixed(2);
      return `plane:${roundedNormal}:${planeOffset}`;
    }

    return `viewport:${viewport.id}`;
  }

  getOrCreateTraceSet(viewport: any) {
    const sliceKey = this.activeTraceSliceKey ?? this.getViewportSliceKey(viewport);
    if (!this.traceSet || this.traceSet.sliceKey !== sliceKey) {
      this.traceSet = {
        sliceKey,
        positive: [],
        negative: [],
      };
    }
    return this.traceSet;
  }

  getLabelmapVolume(segmentationService: any, activeSeg: any, segmentationId: string) {
    const serviceVolume = segmentationService.getLabelmapVolume?.(segmentationId);
    if (serviceVolume) {
      return serviceVolume;
    }

    const volumeId = activeSeg.representationData?.Labelmap?.volumeId;
    return volumeId ? cache.getVolume(volumeId) : null;
  }

  getLabelmapEditData(segmentationService: any, activeSeg: any, segmentationId: string, viewport: any) {
    const labelmapVolume = this.getLabelmapVolume(segmentationService, activeSeg, segmentationId);
    if (labelmapVolume) {
      const scalarData = this.getScalarData(labelmapVolume);
      if (!scalarData) {
        return null;
      }
      return {
        target: labelmapVolume,
        scalarData,
        dimensions: labelmapVolume.dimensions,
        imageData: labelmapVolume.imageData,
      };
    }

    const labelmapData = activeSeg.representationData?.Labelmap;
    const imageIds = labelmapData?.imageIds;
    if (!imageIds?.length) {
      return null;
    }

    const referencedImageIds = labelmapData.referencedImageIds;
    const currentImageId = viewport.getCurrentImageId?.();
    const currentImageIdIndex = viewport.getCurrentImageIdIndex?.() ?? 0;
    const referencedImageIdIndex = referencedImageIds?.indexOf(currentImageId) ?? -1;
    const labelmapImageIndex =
      referencedImageIdIndex >= 0 ? referencedImageIdIndex : currentImageIdIndex;
    const labelmapImageId = imageIds[labelmapImageIndex] ?? imageIds[currentImageIdIndex] ?? imageIds[0];
    const labelmapImage = cache.getImage(labelmapImageId);
    if (!labelmapImage) {
      return null;
    }

    const scalarData = this.getScalarData(labelmapImage);
    if (!scalarData) {
      return null;
    }

    const viewportImageData = viewport.getImageData?.();
    const imageData = viewportImageData?.imageData ?? viewportImageData ?? labelmapImage.imageData;
    const columns =
      labelmapImage.columns ??
      labelmapImage.width ??
      labelmapImage.imageData?.getDimensions?.()[0] ??
      viewportImageData?.dimensions?.[0];
    const rows =
      labelmapImage.rows ??
      labelmapImage.height ??
      labelmapImage.imageData?.getDimensions?.()[1] ??
      viewportImageData?.dimensions?.[1];

    if (!columns || !rows || !imageData) {
      return null;
    }

    return {
      target: labelmapImage,
      scalarData,
      dimensions: [columns, rows, 1],
      imageData,
      forceSliceInfo: { sliceAxis: 2, sliceIndex: 0 },
    };
  }

  commitScalarData(labelmapVolume: any, scalarData: any) {
    labelmapVolume.voxelManager?.setScalarData?.(scalarData);
    labelmapVolume.voxelManager?.modified?.();
    labelmapVolume.imageData?.modified?.();
    labelmapVolume.modified?.();
  }

  notifySegmentationModified(
    servicesManager: any,
    viewport: any,
    viewportId: string,
    segmentationId: string
  ) {
    eventTarget.dispatchEvent(
      new CustomEvent(csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED, {
        detail: { segmentationId },
      })
    );
    triggerSegmentationEvents.triggerSegmentationRepresentationModified(
      viewportId,
      segmentationId,
      LABELMAP
    );
    viewport?.render?.();
    servicesManager.services.cornerstoneViewportService?.getRenderingEngine?.()?.render?.();
  }

  worldToRoundedIjk(imageData: any, worldPoint: [number, number, number]): [number, number, number] {
    const ijk = transformWorldToIndex(imageData, worldPoint);
    return [Math.round(ijk[0]), Math.round(ijk[1]), Math.round(ijk[2])];
  }

  getSliceInfo(points: number[][]) {
    if (points.length === 0) return null;
    let sumI = 0, sumJ = 0, sumK = 0;
    points.forEach(p => {
      sumI += p[0];
      sumJ += p[1];
      sumK += p[2];
    });
    const meanI = sumI / points.length;
    const meanJ = sumJ / points.length;
    const meanK = sumK / points.length;

    let varI = 0, varJ = 0, varK = 0;
    points.forEach(p => {
      varI += Math.pow(p[0] - meanI, 2);
      varJ += Math.pow(p[1] - meanJ, 2);
      varK += Math.pow(p[2] - meanK, 2);
    });

    let sliceAxis = 2; // Default Z
    let minVar = varK;
    if (varI < minVar) {
      sliceAxis = 0;
      minVar = varI;
    }
    if (varJ < minVar) {
      sliceAxis = 1;
      minVar = varJ;
    }

    const sliceIndex = Math.round(sliceAxis === 0 ? meanI : (sliceAxis === 1 ? meanJ : meanK));
    return { sliceAxis, sliceIndex };
  }

  ijkToUv(ijk: number[], sliceAxis: number): [number, number] {
    if (sliceAxis === 0) {
      return [ijk[1], ijk[2]];
    } else if (sliceAxis === 1) {
      return [ijk[0], ijk[2]];
    } else {
      return [ijk[0], ijk[1]];
    }
  }

  uvToIjk(u: number, v: number, sliceAxis: number, sliceIndex: number): [number, number, number] {
    if (sliceAxis === 0) {
      return [sliceIndex, u, v];
    } else if (sliceAxis === 1) {
      return [u, sliceIndex, v];
    } else {
      return [u, v, sliceIndex];
    }
  }

  getLinePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
    const points: [number, number][] = [];
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
      points.push([x, y]);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return points;
  }
}

export default ReassignTool;
