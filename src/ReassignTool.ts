import { BaseTool, drawing, utilities as cstUtils } from '@cornerstonejs/tools';
import { cache, utilities as csUtils } from '@cornerstonejs/core';
import { triggerSegmentationEvents } from '@cornerstonejs/tools';

const { transformWorldToIndex } = csUtils;

class ReassignTool extends BaseTool {
  static toolName = 'ReassignTool';

  isDrawing = false;
  activeTrace: [number, number, number][] = [];
  activeTraceType: 'positive' | 'negative' | null = null;
  positiveTraces: [number, number, number][][] = [];
  negativeTraces: [number, number, number][][] = [];

  // Undo stack for segmentations
  segmentUndoStack: {
    segmentationId: string;
    sliceAxis: number;
    sliceIndex: number;
    originalValues: Int16Array | Uint8Array;
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
    this.positiveTraces = [];
    this.negativeTraces = [];
    this.activeTrace = [];
    this.isDrawing = false;
    this.activeTraceType = null;
  }

  undoChange(servicesManager: any) {
    if (this.segmentUndoStack.length === 0) {
      console.log('Undo stack is empty');
      return;
    }
    const lastChange = this.segmentUndoStack.pop();
    const { segmentationId, sliceAxis, sliceIndex, originalValues } = lastChange;

    const segmentation = cstUtils.segmentation.state.getSegmentation(segmentationId);
    if (!segmentation) return;

    const labelmapData = segmentation.representationData.Labelmap;
    if (!labelmapData || !labelmapData.volumeId) return;

    const labelmapVolume = cache.getVolume(labelmapData.volumeId);
    if (!labelmapVolume) return;

    const scalarData = labelmapVolume.getScalarData();
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

    const { viewportGridService } = servicesManager.services;
    const viewportId = viewportGridService.getActiveViewportId();
    triggerSegmentationEvents.triggerSegmentationRepresentationModified(viewportId, segmentationId);
  }

  onSetToolActive = () => {
    this.clearTraces();
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
    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('keyup', this.keyupHandler);
    this.keyListenerAdded = true;
  }

  removeKeyListener() {
    if (!this.keyListenerAdded) return;
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('keyup', this.keyupHandler);
    this.keyListenerAdded = false;
  }

  keydownHandler = (evt: KeyboardEvent) => {
    if (evt.key === 'Escape') {
      this.clearTraces();
      if (this.servicesManager) {
        const { viewportGridService, cornerstoneViewportService } = this.servicesManager.services;
        const viewportId = viewportGridService.getActiveViewportId();
        const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
        if (viewport) {
          viewport.render();
        }
      }
    } else if (evt.key === 'Control') {
      this.updateToolbarOption('exclude');
    }
  };

  keyupHandler = (evt: KeyboardEvent) => {
    if (evt.key === 'Control') {
      this.updateToolbarOption('include');
    }
  };

  updateToolbarOption(mode: 'include' | 'exclude') {
    this.setDrawMode(mode);
    if (this.servicesManager) {
      const { toolbarService } = this.servicesManager.services;
      const button = toolbarService.getButton('ReassignTool');
      if (button) {
        const option = toolbarService.getOptionById(button, 'reassign-mode');
        if (option) {
          option.value = mode;
          toolbarService.refreshToolbarState();
        }
      }
    }
  }

  preMouseDownCallback = (evt: any): boolean => {
    const eventDetail = evt.detail;
    const { currentPoints } = eventDetail;

    this.isDrawing = true;
    this.activeTraceType = this.drawMode === 'include' ? 'positive' : 'negative';
    this.activeTrace = [currentPoints.world];

    return true; // Consume event
  };

  mouseDragCallback = (evt: any): void => {
    if (!this.isDrawing) return;
    const eventDetail = evt.detail;
    const { currentPoints, enabledElement } = eventDetail;
    this.activeTrace.push(currentPoints.world);
    enabledElement.viewport.render();
  };

  mouseUpCallback = (evt: any): void => {
    if (!this.isDrawing) return;
    const eventDetail = evt.detail;
    const { currentPoints, enabledElement } = eventDetail;
    this.activeTrace.push(currentPoints.world);

    if (this.activeTraceType === 'positive') {
      this.positiveTraces.push(this.activeTrace);
    } else {
      this.negativeTraces.push(this.activeTrace);
    }

    this.isDrawing = false;
    this.activeTrace = [];
    this.activeTraceType = null;

    this.runPlaceholderAlgorithm(enabledElement);
    enabledElement.viewport.render();
  };

  renderAnnotation = (enabledElement: any, svgDrawingHelper: any): void => {
    const { viewport } = enabledElement;
    const annotationUID = 'reassign-traces-annotation';

    // Draw completed positive traces
    this.positiveTraces.forEach((trace, idx) => {
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
    this.negativeTraces.forEach((trace, idx) => {
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
    if (this.isDrawing && this.activeTrace.length > 1) {
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

  runPlaceholderAlgorithm(enabledElement: any) {
    if (this.positiveTraces.length === 0 || this.negativeTraces.length === 0) {
      console.log('Requires at least one positive and one negative trace to run segment editing');
      return;
    }

    if (!this.servicesManager) return;
    const { segmentationService } = this.servicesManager.services;
    const { viewport } = enabledElement;
    const viewportId = viewport.id;

    const activeSeg = segmentationService.getActiveSegmentation(viewportId);
    const activeSegIndexInfo = segmentationService.getActiveSegment(viewportId);
    if (!activeSeg || !activeSegIndexInfo) return;

    const { segmentationId } = activeSeg;
    const { segmentIndex } = activeSegIndexInfo;

    const labelmapData = activeSeg.representationData.Labelmap;
    if (!labelmapData || !labelmapData.volumeId) return;

    const labelmapVolume = cache.getVolume(labelmapData.volumeId);
    if (!labelmapVolume) return;

    const scalarData = labelmapVolume.getScalarData();
    const dimensions = labelmapVolume.dimensions;
    const [X, Y, Z] = dimensions;

    const imageData = labelmapVolume.imageData;

    // Convert world points to 3D voxel indices [i, j, k]
    const posVoxelPoints = this.positiveTraces.flatMap(trace =>
      trace.map(p => transformWorldToIndex(imageData, p))
    );
    const negVoxelPoints = this.negativeTraces.flatMap(trace =>
      trace.map(p => transformWorldToIndex(imageData, p))
    );

    // Combine voxel points to find slice orientation
    const allPoints = [...posVoxelPoints, ...negVoxelPoints];
    const sliceInfo = this.getSliceInfo(allPoints);
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
    this.positiveTraces.forEach(trace => {
      const uvs = trace.map(p => this.ijkToUv(transformWorldToIndex(imageData, p), sliceAxis));
      for (let i = 0; i < uvs.length - 1; i++) {
        posSeedsGrid.push(...this.getLinePoints(uvs[i][0], uvs[i][1], uvs[i + 1][0], uvs[i + 1][1]));
      }
    });

    const negSeedsGrid: [number, number][] = [];
    this.negativeTraces.forEach(trace => {
      const uvs = trace.map(p => this.ijkToUv(transformWorldToIndex(imageData, p), sliceAxis));
      for (let i = 0; i < uvs.length - 1; i++) {
        negSeedsGrid.push(...this.getLinePoints(uvs[i][0], uvs[i][1], uvs[i + 1][0], uvs[i + 1][1]));
      }
    });

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

    // Run simple BFS Voronoi on the 2D slice grid
    const dist = new Float32Array(W * H);
    dist.fill(Infinity);
    const label = new Uint8Array(W * H); // 1 = positive, 2 = negative

    const queue: number[] = [];

    // Push positive seeds
    posSeedsGrid.forEach(([u, v]) => {
      if (u >= 0 && u < W && v >= 0 && v < H) {
        const idx = u + v * W;
        dist[idx] = 0;
        label[idx] = 1;
        queue.push(idx);
      }
    });

    // Push negative seeds
    negSeedsGrid.forEach(([u, v]) => {
      if (u >= 0 && u < W && v >= 0 && v < H) {
        const idx = u + v * W;
        dist[idx] = 0;
        label[idx] = 2;
        queue.push(idx);
      }
    });

    // BFS Queue loop
    let head = 0;
    const dirs = [
      [-1, 0], [1, 0], [0, -1], [0, 1]
    ];

    while (head < queue.length) {
      const currIdx = queue[head++];
      const u = currIdx % W;
      const v = Math.floor(currIdx / W);
      const currDist = dist[currIdx];
      const currLabel = label[currIdx];

      for (let i = 0; i < 4; i++) {
        const nu = u + dirs[i][0];
        const nv = v + dirs[i][1];
        if (nu >= 0 && nu < W && nv >= 0 && nv < H) {
          const nidx = nu + nv * W;
          if (dist[nidx] === Infinity) {
            dist[nidx] = currDist + 1;
            label[nidx] = currLabel;
            queue.push(nidx);
          }
        }
      }
    }

    // Apply the classification results back to the segment (protect other segments)
    idx2d = 0;
    for (let v = 0; v < H; v++) {
      for (let u = 0; u < W; u++) {
        const ijk = this.uvToIjk(u, v, sliceAxis, sliceIndex);
        const scalarIdx = ijk[0] + ijk[1] * X + ijk[2] * X * Y;
        const currentVoxelVal = scalarData[scalarIdx];

        if (currentVoxelVal === 0 || currentVoxelVal === segmentIndex) {
          const classification = label[idx2d];
          if (classification === 1) {
            scalarData[scalarIdx] = segmentIndex;
          } else if (classification === 2) {
            scalarData[scalarIdx] = 0;
          }
        }
        idx2d++;
      }
    }

    triggerSegmentationEvents.triggerSegmentationRepresentationModified(viewportId, segmentationId);
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
