import { addTool } from '@cornerstonejs/tools';
import { Icons } from '@ohif/ui-next';
import { id } from './id';
import ReassignTool from './ReassignTool';
import { ToolLabelmapEditWithAssign } from './icon';

export default {
  id,

  preRegistration: ({ servicesManager, commandsManager }) => {
    // 1. Register the custom SVG icon
    Icons.addIcon('ToolLabelmapEditWithAssign', ToolLabelmapEditWithAssign);

    // 2. Register ReassignTool globally with Cornerstone3D
    addTool(ReassignTool);
    ReassignTool.sharedServicesManager = servicesManager;

    // 3. Register our button dynamically inside the toolbarService and add it to the LabelMapTools toolbox
    const { toolbarService, toolGroupService } = servicesManager.services;

    const reassignButton = {
      id: 'ReassignTool',
      uiType: 'ohif.toolBoxButton',
      props: {
        icon: 'ToolLabelmapEditWithAssign',
        label: 'Reassign Segment',
        tooltip: 'Reassign segment voxels using positive (green) and negative (red) traces. Use the mode option or G to switch include/exclude.',
        evaluate: [
          {
            name: 'evaluate.cornerstone.segmentation',
            toolNames: ['ReassignTool'],
          },
          {
            name: 'evaluate.cornerstone.hasSegmentationOfType',
            segmentationRepresentationType: 'Labelmap',
          },
        ],
        commands: [
          {
            commandName: 'setToolActiveToolbar',
            commandOptions: {
              toolName: 'ReassignTool',
            },
          },
          {
            commandName: 'activateSelectedSegmentationOfType',
            commandOptions: {
              segmentationRepresentationType: 'Labelmap',
            },
          },
        ],
        options: [
          {
            name: 'Mode',
            type: 'radio',
            id: 'reassign-mode',
            value: 'include',
            values: [
              { value: 'include', label: 'Include' },
              { value: 'exclude', label: 'Exclude' },
            ],
            commands: ({ commandsManager, options }) => {
              const selectedValue = options.find(opt => opt.id === 'reassign-mode').value;
              commandsManager.run('setReassignToolMode', { mode: selectedValue });
            },
          },
          {
            name: 'Reset Traces',
            type: 'button',
            id: 'reassign-reset',
            commands: 'resetReassignTraces',
          },
          {
            name: 'Undo Segment Change',
            type: 'button',
            id: 'reassign-undo',
            commands: 'undoReassignChange',
          },
        ],
      },
    };

    // Re-register button and add to LabelMapTools whenever toolbar resets (onModeEnter wipes all state)
    let isUpdatingToolbar = false;
    toolbarService.subscribe(toolbarService.EVENTS.TOOL_BAR_MODIFIED, () => {
      if (isUpdatingToolbar) return;
      isUpdatingToolbar = true;
      try {
        if (!toolbarService.getButton('ReassignTool')) {
          toolbarService.register([reassignButton]);
        }
        const labelMapTools = toolbarService.getButtonSection('LabelMapTools') || [];
        const hasButton = labelMapTools.some(btn => btn?.id === 'ReassignTool');
        if (!hasButton) {
          toolbarService.updateSection('LabelMapTools', ['ReassignTool']);
        }
      } finally {
        isUpdatingToolbar = false;
      }
    });

    // Initial registration
    toolbarService.register([reassignButton]);

    // Helper to add tool to groups
    const addToolToGroup = (toolGroupId: string) => {
      try {
        toolGroupService.addToolsToToolGroup(toolGroupId, {
          passive: [{ toolName: 'ReassignTool' }],
        });
      } catch (err) {
        console.warn(`Could not add ReassignTool to group ${toolGroupId}:`, err);
      }
    };

    // Add to all current groups
    const existingGroupIds = toolGroupService.getToolGroupIds() || [];
    existingGroupIds.forEach(id => addToolToGroup(id));

    // Add to any newly created groups
    toolGroupService.subscribe(toolGroupService.EVENTS.TOOLGROUP_CREATED, ({ toolGroupId }) => {
      addToolToGroup(toolGroupId);
    });
  },

  getCommandsModule: ({ servicesManager }) => {
    const { toolGroupService, viewportGridService } = servicesManager.services;

    const getActiveToolInstance = () => {
      const viewportId = viewportGridService.getActiveViewportId();
      const toolGroup = toolGroupService.getToolGroupForViewport(viewportId);
      const toolInstance = toolGroup?.getToolInstance('ReassignTool') as ReassignTool;
      if (toolInstance) {
        toolInstance.servicesManager = servicesManager;
      }
      return toolInstance;
    };

    const actions = {
      setReassignToolMode: ({ mode }) => {
        const toolInstance = getActiveToolInstance();
        if (toolInstance) {
          toolInstance.updateToolbarOption(mode);
        }
      },
      toggleReassignToolMode: ({ evt }) => {
        if (evt?.repeat) {
          return;
        }
        const toolInstance = getActiveToolInstance();
        if (toolInstance) {
          const nextMode = toolInstance.drawMode === 'include' ? 'exclude' : 'include';
          toolInstance.updateToolbarOption(nextMode);
        }
      },
      resetReassignTraces: () => {
        const toolInstance = getActiveToolInstance();
        if (toolInstance) {
          toolInstance.clearTraces();
          // Redraw active viewport
          const { cornerstoneViewportService } = servicesManager.services;
          const viewportId = viewportGridService.getActiveViewportId();
          const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
          if (viewport) {
            viewport.render();
          }
        }
      },
      undoReassignChange: () => {
        const toolInstance = getActiveToolInstance();
        if (toolInstance) {
          toolInstance.undoChange(servicesManager);
        }
      },
    };

    const definitions = {
      setReassignToolMode: {
        commandFn: actions.setReassignToolMode,
      },
      toggleReassignToolMode: {
        commandFn: actions.toggleReassignToolMode,
      },
      resetReassignTraces: {
        commandFn: actions.resetReassignTraces,
      },
      undoReassignChange: {
        commandFn: actions.undoReassignChange,
      },
    };

    return {
      actions,
      definitions,
      defaultContext: 'VIEWER',
    };
  },

  getCustomizationModule: () => [
    {
      name: 'default',
      value: {
        'ohif.hotkeyBindings': {
          $push: [
            {
              commandName: 'toggleReassignToolMode',
              label: 'Toggle Reassign Include/Exclude',
              keys: ['g'],
              isEditable: true,
            },
          ],
        },
      },
    },
  ],
};
