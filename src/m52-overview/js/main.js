import { createStore } from 'redux';
import React from 'react';
import ReactDOM from 'react-dom';
import {Record, OrderedSet as ImmutableSet} from 'immutable';
import { connect, Provider } from 'react-redux';

import {hierarchicalM52, hierarchicalAggregated, m52ToAggregated} from '../../shared/js/finance/memoized';
import csvStringToM52Instructions from '../../shared/js/finance/csvStringToM52Instructions.js';
import visitHierarchical from '../../shared/js/finance/visitHierarchical.js';
import {PAR_PUBLIC_VIEW, PAR_PRESTATION_VIEW, M52_INSTRUCTION, AGGREGATED_INSTRUCTION, EXPENDITURES, REVENUE} from '../../shared/js/finance/constants';

import TopLevel from './components/TopLevel.js';


function reducer(state, action){
    const {type} = action;

    switch(type){
    case 'M52_INSTRUCTION_RECEIVED':
        return state.set('M52Instruction', action.m52Instruction);
    case 'M52_INSTRUCTION_USER_NODE_OVERED':
        return state
            .set('over', action.node ? 
                new InstructionNodeRecord({
                    type: M52_INSTRUCTION,
                    node: action.node
                }) : 
                undefined
            );
    case 'AGGREGATED_INSTRUCTION_USER_NODE_OVERED':
        return state
            .set('over', action.node ? 
                new InstructionNodeRecord({
                    type: AGGREGATED_INSTRUCTION,
                    node: action.node
                }) : 
                undefined
            );
    case 'M52_INSTRUCTION_USER_NODE_SELECTED': {
        const { node } = action;
        const {node: alreadySelectedNode} = state.set('selection') || {};

        return state
            .set('selection', node && node !== alreadySelectedNode ? 
                new InstructionNodeRecord({
                    type: M52_INSTRUCTION,
                    node
                }) : 
                undefined
            );
    }
    case 'AGGREGATED_INSTRUCTION_USER_NODE_SELECTED': {
        const { node } = action;
        const {node: alreadySelectedNode} = state.set('selection') || {};

        return state
            .set('selection', node && node !== alreadySelectedNode ? 
                new InstructionNodeRecord({
                    type: AGGREGATED_INSTRUCTION,
                    node
                }) : 
                undefined
            );
    }
    case 'RDFI_CHANGE':
        return state
            .set('RDFI', action.rdfi)
            .set('over', undefined)
            .set('selection', undefined);
    case 'DF_VIEW_CHANGE':
        return state
            .set('DF_VIEW', action.dfView)
            .set('over', undefined)
            .set('selection', undefined);
    default:
        console.warn('Unknown action type', type);
        return state;
    }
}


let childToParent;

function findSelectedNodeAncestors(tree, selectedNode){
    if(!selectedNode)
        return undefined;

    if(!childToParent)
        childToParent = new WeakMap();

    if(tree === selectedNode){
        let result = [];
        let current = selectedNode;
        while(current !== undefined){
            result.push(current);
            current = childToParent.get(current);
        }
        return new ImmutableSet(result);
    }
    
    let ret;

    if(tree.children){
        Array.from(tree.children.values()).forEach(child => {
            childToParent.set(child, tree);
            const ancestors = findSelectedNodeAncestors(child, selectedNode);
            if(ancestors)
                ret = ancestors;
        })
    }

    return ret;
}

function findSelectedAggregatedNodesByM52Rows(aggregatedNode, m52Rows){
    let result = [];

    visitHierarchical(aggregatedNode, n => {
        const elements = Array.from(n.elements);
        if(m52Rows.some(row => elements.some(el => el["M52Rows"].has(row)))){
            result.push(n);
        }
    });

    return new ImmutableSet(result);
}

function findSelectedM52NodesByM52Rows(M52Node, m52Rows){
    let result = [];

    visitHierarchical(M52Node, n => {
        if(m52Rows.some(row => n.elements.has(row))){
            result.push(n);
        }
    });

    return new ImmutableSet(result);
}


function mapStateToProps(state){
    const m52Instruction = state.get('M52Instruction');
    const rdfi = state.get('RDFI');
    const view = state.get('DF_VIEW');
    const over = state.get('over');
    const selection = state.get('selection');
    const {type: overType, node: overedNode} = over || {};
    const {type: selectedType, node: selectedNode} = selection || {};

    const expOrRev = rdfi[0] === 'D' ? EXPENDITURES : REVENUE;

    if(!m52Instruction)
        return {};

    const mainHighlightNode = overedNode || selectedNode;
    const mainHighlightType = overType || selectedType;

    const aggregatedInstruction = m52ToAggregated(m52Instruction);
    const M52Hierarchical = hierarchicalM52(m52Instruction, rdfi);
    
    const aggregatedHierarchical = hierarchicalAggregated(aggregatedInstruction);

    const rdNode = [...aggregatedHierarchical.children].find(c => c.id === expOrRev);
    let rdfiNode = [...rdNode.children].find(c => c.id === rdfi);

    if(rdfi === 'DF'){
        switch(view){
            case PAR_PUBLIC_VIEW: 
                // per public is DF-2, so remove DF-1
                rdfiNode = rdfiNode.removeIn(['children', 0]);
                break;   
            case PAR_PRESTATION_VIEW: 
                // per prestation is DF-1, so remove DF-2
                rdfiNode = rdfiNode.removeIn(['children', 1]);
                break;
            default:
                throw new Error('Misunderstood view ('+view+')');
        }
    }

    let M52HighlightedNodes;
    let aggregatedHighlightedNodes;

    
    if(mainHighlightType === M52_INSTRUCTION){
        M52HighlightedNodes = findSelectedNodeAncestors(M52Hierarchical, mainHighlightNode);
        aggregatedHighlightedNodes = findSelectedAggregatedNodesByM52Rows(rdfiNode, Array.from(mainHighlightNode.elements))
    }
    else{
        if(mainHighlightType === AGGREGATED_INSTRUCTION){
            aggregatedHighlightedNodes = findSelectedNodeAncestors(rdfiNode, mainHighlightNode);
            let m52Rows = new ImmutableSet();
            mainHighlightNode.elements.forEach(e => m52Rows = m52Rows.union(e["M52Rows"]));

            M52HighlightedNodes = findSelectedM52NodesByM52Rows(M52Hierarchical, m52Rows);
        }
    }

    return {
        rdfi, dfView: view,
        m52Instruction, aggregatedInstruction,
        M52Hierarchical, M52HighlightedNodes,
        aggregatedHierarchical: rdfiNode, aggregatedHighlightedNodes,
        over, selection
    };
}

function mapDispatchToProps(dispatch){
    return {
        onM52NodeOvered(node){
            dispatch({
                type: 'M52_INSTRUCTION_USER_NODE_OVERED',
                node
            });
        },
        onAggregatedNodeOvered(node){
            dispatch({
                type: 'AGGREGATED_INSTRUCTION_USER_NODE_OVERED',
                node
            });
        },
        onM52NodeSelected(node){
            console.log('onM52NodeSelected', node)
            dispatch({
                type: 'M52_INSTRUCTION_USER_NODE_SELECTED',
                node
            });
        },
        onAggregatedNodeSelected(node){
            dispatch({
                type: 'AGGREGATED_INSTRUCTION_USER_NODE_SELECTED',
                node
            });
        },
        onRDFIChange(rdfi){
            dispatch({
                type: 'RDFI_CHANGE',
                rdfi
            });
        },
        onAggregatedDFViewChange(dfView){
            console.log('onAggregatedDFViewChange', dfView);
            dispatch({
                type: 'DF_VIEW_CHANGE',
                dfView
            });
        },
        onNewM52CSVFile(content){
            dispatch({
                type: 'M52_INSTRUCTION_RECEIVED',
                m52Instruction: csvStringToM52Instructions(content),
            });
        }
    };
}

const BoundTopLevel = connect(
  mapStateToProps,
  mapDispatchToProps
)(TopLevel);


const InstructionNodeRecord = Record({
    type: undefined,
    node: undefined
});

const StoreRecord = Record({
    M52Instruction: undefined,
    selection: undefined,
    over: undefined,
    RDFI: undefined,
    DF_VIEW: undefined
});

const store = createStore(
    reducer,
    new StoreRecord({
        RDFI: 'DF',
        DF_VIEW: PAR_PUBLIC_VIEW
    })
);


fetch('./data/finances/cedi_2015_CA.csv').then(resp => resp.text())
    .then(csvStringToM52Instructions)
    .then(m52Instruction => {
        store.dispatch({
            type: 'M52_INSTRUCTION_RECEIVED',
            m52Instruction,
        });
    });

ReactDOM.render(
    React.createElement(
        Provider,
        {store},
        React.createElement(BoundTopLevel)
    ),
    document.querySelector('.react-container')
);

