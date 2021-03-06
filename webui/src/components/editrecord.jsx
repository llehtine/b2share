import React from 'react/lib/ReactWithAddons';
import { Link } from 'react-router'
import { Map, List, fromJS } from 'immutable';
import { compare } from 'fast-json-patch';

import Toggle from 'react-toggle';
import { DateTimePicker, Multiselect, DropdownList, NumberPicker } from 'react-widgets';
import moment from 'moment';
import momentLocalizer from 'react-widgets/lib/localizers/moment';
import numberLocalizer from 'react-widgets/lib/localizers/simple-number';
momentLocalizer(moment);
numberLocalizer();

import { serverCache, notifications, Error, browser } from '../data/server';
import { keys, pairs, objEquals } from '../data/misc';
import { Wait, Err } from './waiting.jsx';
import { HeightAnimate, ReplaceAnimate } from './animate.jsx';
import { getSchemaOrderedMajorAndMinorFields } from './schema.jsx';
import { EditFiles } from './editfiles.jsx';
import { SelectLicense } from './selectlicense.jsx';
import { SelectBig } from './selectbig.jsx';


export const NewRecordRoute = React.createClass({
    mixins: [React.addons.LinkedStateMixin],

    getInitialState() {
        return {
            community_id: null,
            title: "",
            errors: {},
        }
    },

    setError(id, msg) {
        const err = this.state.errors;
        err[id] = msg;
        this.setState({errors: this.state.errors});
    },

    createAndGoToRecord(event) {
        event.preventDefault();
        if (!this.state.title.length) {
            this.setError('title', "Please add a (temporary) record title");
            return;
        }
        if (!this.state.community_id) {
            this.setError('community', "Please select a target community");
            return;
        }
        const json_record = {
            community: this.state.community_id,
            titles: [{
                title: this.state.title,
            }],
            open_access: true,
        }
        serverCache.createRecord(json_record, record => browser.gotoEditRecord(record.id));
    },

    selectCommunity(community_id) {
        this.setState({community_id: community_id});
    },

    renderCommunity(community) {
        const cid = community.get('id');
        const active = cid === this.state.community_id;
        return (
            <div className="col-lg-2 col-sm-3 col-xs-6" key={community.get('id')}>
                { renderSmallCommunity(community, active, this.selectCommunity.bind(this, cid)) }
            </div>
        );
    },

    renderCommunityList(communities) {
        if (!communities) {
            return <Wait/>;
        }
        return (
            <div className="container-fluid">
                <div className="row">
                    { communities.map(this.renderCommunity) }
                </div>
            </div>
        );
    },

    onTitleChange(event) {
        this.setState({title:event.target.value});
    },

    componentWillMount() {
        const user = serverCache.getUser();
        if (!user || !user.get('name')) {
            notifications.warning('Please login. A new record can only be created by logged in users.');
        }
    },

    render() {
        const training_site = serverCache.getInfo().get('training_site_link');
        const communities = serverCache.getCommunities();
        if (communities instanceof Error) {
            return <Err err={communities}/>;
        }
        const gap = {marginTop:'1em'};
        const biggap = {marginTop:'2em'};
        const stitle = {marginTop:'1em'};
        if (this.state.errors.title) {
            stitle.color = "red";
        }
        const scomm = {marginTop:'1em'};
        if (this.state.errors.community) {
            scomm.color = "red";
        }
        return (
            <div className="new-record">
                { training_site ?
                    <div className="row">
                        <div className="col-sm-9 col-sm-offset-3">
                            <p>Please use <a href={training_site}>{training_site}</a> for testing or training.</p>
                        </div>
                    </div>
                    : false }
                <div className="row">
                    <form className="form-horizontal" onSubmit={this.createAndGoToRecord}>
                        <div className="form-group row">
                            <label htmlFor="title" className="col-sm-3 control-label" style={stitle}>
                                <span style={{float:'right'}}>Title</span>
                            </label>
                            <div className="col-sm-9" style={gap}>
                                <input type="text" className="form-control" id='title'
                                    style={{fontSize:24, height:48}}
                                    value={this.state.title} onChange={this.onTitleChange} />
                            </div>
                        </div>

                        <div className="form-group row">
                            <label htmlFor="community" className="col-sm-3 control-label" style={scomm}>
                                <span style={{float:'right'}}>Community</span>
                            </label>
                            <div className="col-sm-9">
                                {this.renderCommunityList(communities)}
                            </div>
                        </div>

                        <div className="form-group submit row">
                            {this.state.errors.title ?
                                <div className="col-sm-9 col-sm-offset-3">{this.state.errors.title} </div>: false }
                            {this.state.errors.community ?
                                <div className="col-sm-9 col-sm-offset-3">{this.state.errors.community} </div> : false }
                            <div className="col-sm-offset-3 col-sm-9" style={gap}>
                                <button type="submit" className="btn btn-primary btn-default btn-block">
                                    Create Draft Record</button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        );
    }
});


export const EditRecordRoute = React.createClass({
    render() {
        const { id } = this.props.params;
        const record = serverCache.getDraft(id);
        if (!record) {
            return <Wait/>;
        }
        if (record instanceof Error) {
            return <Err err={record}/>;
        }
        const [rootSchema, blockSchemas] = serverCache.getRecordSchemas(record);
        if (rootSchema instanceof Error) {
            return <Err err={rootSchema}/>;
        }
        const community = serverCache.getCommunity(record.getIn(['metadata', 'community']));
        if (community instanceof Error) {
            return <Err err={community}/>;
        }
        serverCache.getDraftFiles(id);

        return (
            <ReplaceAnimate>
                <EditRecord record={record} community={community} rootSchema={rootSchema} blockSchemas={blockSchemas}/>
            </ReplaceAnimate>
        );
    }
});


const EditRecord = React.createClass({
    getInitialState() {
        return {
            record: null,
            fileState: 'done',
            modal: null,
            errors: {},
            dirty: false,
        };
    },

    renderFileBlock() {
        const setState = (fileState, message) => {
            const errors = this.state.errors;
            if (fileState === 'done') {
                delete errors.files;
            } else if (fileState === 'error') {
                errors.files = message;
            } else {
                errors.files = 'Waiting for files to finish uploading';
            }
            this.setState({fileState, errors});
        }
        const files = this.props.record.get('files');
        if (files instanceof Error) {
            return <Err err={files}/>;
        }
        return (
            <EditFiles files={files ? files.toJS() : []}
                record={this.props.record}
                setState={setState}
                setModal={modal => this.setState({modal})} />
        );
    },

    setError(id, msg) {
        const err = this.state.errors;
        err[id] = msg;
        this.setState({errors: this.state.errors});
    },

    getValue(path) {
        const r = this.state.record;
        if (!r) {
            return null;
        }
        let v = r.getIn(path);
        if (v != undefined && v != null && v.toJS) {
            v = v.toJS();
        }
        return v;
    },

    setValue(schema, path, value) {
        let r = this.state.record;
        if (!r) {
            return null;
        }
        for (let i = 0; i < path.length; ++i) {
            const el = path[i];
            if (Number.isInteger(el)) {
                console.assert(i > 0);
                const subpath = path.slice(0, i);
                const list = r.getIn(subpath);
                if (!list) {
                    r = r.setIn(subpath, List());
                } else {
                    console.assert(el < 1000);
                    while (el >= list.count()) {
                        const x = Number.isInteger(path[i+1]) ? List() : Map();
                        const list2 = list.push(x);
                        r = r.setIn(subpath, list2);
                    }
                }
            }
        }
        console.assert(!Array.isArray(value));
        r = value !== undefined ? r.setIn(path, value) : r.deleteIn(path);
        const errors = this.state.errors;
        const pathstr = path.join('/');
        if (!this.validField(schema, value)) {
            errors[pathstr] = `Please provide a value for the required field ${pathstr}`
        } else {
            delete errors[pathstr];
        }
        this.setState({record:r, errors, dirty:true});
    },

    renderScalarField(schema, path) {
        const pathstr = path.join('/');
        const validClass = (this.state.errors[pathstr]) ? " invalid-field " : "";
        const type = schema.get('type');
        const value = this.getValue(path);
        const setter = x => this.setValue(schema, path, x);
        if (type === 'boolean') {
            return (
                <div className={validClass} style={{lineHeight:"30px"}}>
                    <Toggle checked={value} onChange={event => setter(event.target.checked)}/>
                    <div style={{display:"inline", "verticalAlign":"super"}}>{value ? " True" : " False"}</div>
                </div>
            );
        } else if (type === 'integer') {
            return <NumberPicker className={validClass} defaultValue={value} onChange={setter} />
        } else if (type === 'number') {
            return <NumberPicker className={validClass} defaultValue={value} onChange={setter} />
        } else if (type === 'string') {
            const value_str = ""+(value || "");
            if (schema.get('enum')) {
                return <DropdownList className={validClass} defaultValue={value_str} data={schema.get('enum').toJS()} onChange={setter} />
            } else if (schema.get('format') === 'date-time') {
                const initial = (value_str && value_str !== "") ? moment(value_str).toDate() : null;
                return <DateTimePicker className={validClass} defaultValue={initial}
                        onChange={date => setter(moment(date).toISOString())} />
            } else if (schema.get('format') === 'email') {
                return <input type="text" className={"form-control"+ validClass} placeholder="email@example.com"
                        value={value_str} onChange={event => setter(event.target.value)} />
            } else if (path[path.length-1] === 'description') {
                return <textarea className={"form-control"+ validClass} rows={value_str.length > 1000 ? 10 : 5}
                        value={value_str} onChange={event => setter(event.target.value)} />
            } else {
                return <input type="text" className={"form-control"+ validClass}
                        value={value_str} onChange={event => setter(event.target.value)} />
            }
        } else if (schema.get('enum')) {
            const value_str = ""+(value || "");
            return <DropdownList className={"form-control"+ validClass} data={schema.get('enum').toJS()}
                     defaultValue={value_str} onChange={setter} />
        } else {
            console.error("Cannot render field of schema:", schema.toJS());
        }
    },

    renderLicenseField(schema, path) {
        const onSelect = (license) => {
            console.assert(path.length >= 1);
            const licenseData = {
                'license': license.name,
                'license_uri': license.url,
            };
            this.setValue(schema, path.slice(0, -1), fromJS(licenseData));
        };
        return (
            <div className="input-group" style={{marginTop:'0.25em', marginBottom:'0.25em'}}>
                { this.renderScalarField(schema, path) }
                <SelectLicense title="Select License" onSelect={onSelect}
                    setModal={modal => this.setState({modal})} />
            </div>
        );
    },

    renderOpenAccessField(schema, path, disabled) {
        const value = this.getValue(path);
        return (
            <div style={{lineHeight:"30px"}}>
                <Toggle checked={value} onChange={event => this.setValue(schema, path, event.target.checked)} disabled={disabled}/>
                <div style={{display:"inline", "verticalAlign":"super"}}>{value ? " True" : " False"}</div>
            </div>
        );
    },

    renderEmbargoField(schema, path) {
        const date = this.getValue(path);
        const initial = (date && date !== "") ? moment(date).toDate() : null;
        const onChange = date => {
            const m = moment(date);
            // true if embargo is in the past
            const access = m.isValid() ? (moment().diff(m) > 0) : true;
            this.state.record = this.state.record.set('open_access', access);
            // setValue will call setState
            this.setValue(schema, path, m.isValid() ? m.toISOString() : undefined);
        };
        return (
            <DateTimePicker format={"LL"} time={false} finalView={"year"}
                        defaultValue={initial} onChange={onChange} />
        );
    },

    renderFieldTree(id, schema, path) {
        if (!schema) {
            return false;
        }
        const newpath = (last) => { const np = path.slice(); np.push(last); return np; };

        let field = false;
        if (objEquals(path, ['community'])) {
            field = this.props.community ? renderSmallCommunity(this.props.community, false) : <Wait/>
        } else if (objEquals(path, ['license', 'license'])) {
            field = this.renderLicenseField(schema, path);
        } else if (objEquals(path, ['open_access'])) {
            const embargo = this.getValue(schema, newpath('embargo_date'));
            const disabled = embargo && moment(embargo).isValid();
            field = this.renderOpenAccessField(schema, path, disabled);
        } else if (objEquals(path, ['embargo_date'])) {
            field = this.renderEmbargoField(schema, path);
        } else if (objEquals(path, ['language']) || objEquals(path, ['language_code'])) {
            const languages = serverCache.getLanguages();
            field = (languages instanceof Error) ? <Err err={languages}/> :
                <SelectBig data={languages}
                    onSelect={x=>this.setValue(schema, path, x)} value={this.getValue(path)} />;
        } else if (path.length === 2 && path[0] === 'disciplines') {
            const disciplines = serverCache.getDisciplines();
            field = (disciplines instanceof Error) ? <Err err={disciplines}/> :
                <SelectBig data={disciplines}
                    onSelect={x=>this.setValue(schema, path, x)} value={this.getValue(path)} />;
        } else if (schema.get('type') === 'array') {
            const arrSchema = schema.get('items');
            const raw_values = this.getValue(path);
            const len = (raw_values && raw_values.length) || 1;
            const arrField = [...Array(len).keys()].map(i =>
                this.renderFieldTree(id+`[${i}]`, arrSchema, newpath(i)));
            const btnAddRemove = (ev, pos) => {
                ev.preventDefault();
                if (pos === 0) {
                    const arrType = arrSchema.get('type');
                    const values = this.getValue(path);
                    values.push(arrType === 'array' ? List() : arrType === 'object' ? Map() : null);
                    this.setValue(schema, path, fromJS(values));
                } else {
                    this.setValue(schema, newpath(pos), undefined);
                }
                const v = this.getValue(path);
            }
            field = arrField.map((f, i) =>
                <div className="container-fluid">
                    <div className="row" key={i} style={{marginBottom:'0.5em'}}>
                        {f}
                        <div className={"col-sm-offset-10 col-sm-2"} style={{paddingRight:0}}>
                            <btn className="btn btn-default btn-xs" style={{float:'right'}} onClick={ev => btnAddRemove(ev, i)}>
                                {i == 0 ?
                                    <span><span className="glyphicon glyphicon-plus-sign" aria-hidden="true"/> Add </span> :
                                    <span><span className="glyphicon glyphicon-minus-sign" aria-hidden="true"/> Remove </span>
                                }
                            </btn>
                        </div>
                    </div>
                </div> );
        } else if (schema.get('type') === 'object') {
            const props = schema.get('properties');
            field = schema.get('properties').entrySeq().map(([pid, pschema]) =>
                        this.renderFieldTree(pid, pschema, newpath(pid)));
        } else {
            field = this.renderScalarField(schema, path);
        }

        const arrstyle = schema.get('type') !== 'array' ? {} : {
            paddingLeft:'10px',
            borderLeft:'1px solid black',
            borderRadius:'4px',
        };
        const pathstr = path.join('/');
        const isError = this.state.errors.hasOwnProperty(pathstr);
        const onfocus = () => { this.setState({showhelp: path.slice()}); }
        const onblur = () => { this.setState({showhelp: null}); }
        const title = schema.get('title');
        return (
            <div className="row" key={id}>
                <div key={id} style={{marginBottom:'0.5em'}} title={schema.get('description')}>
                    {!title ? false :
                        <label htmlFor={id} className="col-sm-3 control-label" style={{fontWeight:'bold'}}>
                            <span style={{float:'right', color:isError?'red':'black'}}>
                                {title} {schema.get('isRequired') ? "*":""}
                            </span>
                        </label> }
                    <div className={title ? "col-sm-9":"col-sm-12"} style={arrstyle} onFocus={onfocus} onBlur={onblur}>
                        <div className="container-fluid" style={{paddingLeft:0, paddingRight:0}}>
                            {field}
                        </div>
                    </div>
                </div>
                <div>
                    <div className="col-sm-offset-3 col-sm-9">
                        <HeightAnimate>
                            { this.state.showhelp && objEquals(this.state.showhelp, path) ?
                                <div style={{marginLeft:'1em', paddingLeft:'1em', borderLeft: '1px solid #eee'}}>
                                    <p> {schema.get('description')} </p>
                                </div>
                              : false }
                        </HeightAnimate>
                    </div>
                </div>
            </div>
        );
    },

    renderFieldBlock(schemaID, schema) {
        if (!schema) {
            return <Wait key={schemaID}/>;
        }
        let open = this.state.folds ? this.state.folds[schemaID||""] : false;
        const plugins = schema.getIn(['b2share', 'plugins']);

        function renderBigFieldTree([pid, pschema]) {
            const datapath = schemaID ? ['community_specific', schemaID, pid] : [pid];
            const f = this.renderFieldTree(pid, pschema, datapath);
            if (!f) {
                return false;
            }
            const style = {
                marginTop:'0.25em',
                marginBottom:'0.25em',
                paddingTop:'0.25em',
                paddingBottom:'0.25em',
            };
            return <div style={style} key={pid}> {f} </div>;
        }
        const [majors, minors] = getSchemaOrderedMajorAndMinorFields(schema);

        const majorFields = majors.entrySeq().map(renderBigFieldTree.bind(this));
        const minorFields = minors.entrySeq().map(renderBigFieldTree.bind(this));

        const onMoreDetails = e => {
            e.preventDefault();
            const folds = this.state.folds || {};
            folds[schemaID||""] = !folds[schemaID||""];
            this.setState({folds:folds});
        }

        const foldBlock = minorFields.count() ? (
            <div className="col-sm-12">
                <div className="row">
                    <div className="col-sm-offset-3 col-sm-9" style={{marginTop:'1em', marginBottom:'1em'}}>
                        <a href="#" onClick={onMoreDetails} style={{padding:'0.5em'}}>
                            { !open ?
                                <span>Show more details <span className="glyphicon glyphicon-chevron-right" style={{top:'0.1em'}} aria-hidden="true"/></span>:
                                <span>Hide details <span className="glyphicon glyphicon-chevron-down" style={{top:'0.2em'}} aria-hidden="true"/></span> }
                        </a>
                    </div>
                </div>
                <HeightAnimate delta={20}>
                    { open ? minorFields : false }
                </HeightAnimate>
            </div>
        ) : false;

        const blockStyle=schemaID ? {marginTop:'1em', paddingTop:'1em', borderTop:'1px solid #eee'} : {};
        return (
            <div style={blockStyle} key={schemaID}>
                <div className="row">
                    <h3 className="col-sm-12" style={{marginBottom:0}}>
                        { schemaID ? schema.get('title') : 'Basic fields' }
                    </h3>
                </div>
                <div className="row">
                    <div className="col-sm-12">
                        { majorFields }
                    </div>
                </div>
                <div className="row">
                    { foldBlock }
                </div>
            </div>
        );
    },

    componentWillMount() {
        this.componentWillReceiveProps(this.props);
    },

    componentWillReceiveProps(props) {
        if (props.record && !this.state.record) {
            let record = props.record.get('metadata');
            if (!record.has('community_specific')) {
                record = record.set('community_specific', Map());
            }
            record = addEmptyMetadataBlocks(record, props.blockSchemas) || record;
            this.setState({record});
        } else if (this.state.record && props.blockSchemas) {
            const record = addEmptyMetadataBlocks(this.state.record, props.blockSchemas);
            if (record) {
                this.setState({record});
            }
        }

        function addEmptyMetadataBlocks(record, blockSchemas) {
            if (!blockSchemas || !blockSchemas.length) {
                return false;
            }
            let updated = false;
            blockSchemas.forEach(([blockID, _]) => {
                if (!record.get('community_specific').has(blockID)) {
                    record = record.setIn(['community_specific', blockID], Map());
                    updated = true;
                }
            });
            return updated ? record : null;
        }
    },

    validField(schema, value) {
        if (schema && schema.get('isRequired')) {
            // 0 is fine
            if (value === undefined || value === null || value === "")
                return false;
        }
        return true;
    },

    findValidationErrorsRec(errors, schema, path, value) {
        const isValue = (value !== undefined && value !== null && value !== "");
        if (schema.get('isRequired') && !isValue) {
            const pathstr = path.join("/");
            errors[pathstr] = `Please provide a value for field "${pathstr}"`;
            return;
        }

        const newpath = (last) => { const np = path.slice(); np.push(last); return np; };
        const type = schema.get('type');
        if (type === 'array') {
            if (isValue && schema.get('items')) {
                value.forEach((v, i) =>
                    this.findValidationErrorsRec(errors, schema.get('items'), newpath(i), v));
            }
        } else if (type === 'object') {
            if (isValue && schema.get('properties')) {
                schema.get('properties').entrySeq().forEach(([pid, pschema]) =>
                    this.findValidationErrorsRec(errors, pschema, newpath(pid), value.get(pid)));
            }
        } else {
            if (!this.validField(schema, value)) {
                const pathstr = path.join("/");
                errors[pathstr] = `Please provide a valid value for field "${pathstr}"`;
            }
        }
    },

    findValidationErrors() {
        const rootSchema = this.props.rootSchema;
        const blockSchemas = this.props.blockSchemas || [];
        if (!rootSchema) {
            return;
        }
        const errors = {};
        const r = this.state.record;

        this.findValidationErrorsRec(errors, rootSchema, [], r);
        blockSchemas.forEach(([blockID, blockSchema]) => {
            const schema = blockSchema.get('json_schema');
            const path = ['community_specific', blockID];
            this.findValidationErrorsRec(errors, schema, path, r.getIn(path));
        });

        if (this.state.errors.files) {
            errors.files = this.state.errors.files;
        }
        return errors;
    },

    updateRecord(event) {
        event.preventDefault();
        const errors = this.findValidationErrors();
        if (this.state.fileState !== 'done' || pairs(errors).length > 0) {
            this.setState({errors});
            return;
        }
        const original = this.props.record.get('metadata').toJS();
        const updated = this.state.record.toJS();
        const patch = compare(original, updated);
        if (!patch || !patch.length) {
            this.setState({dirty:false});
            return;
        }
        const onSaveAndPublish = (record) => {
            browser.gotoRecord(record.id);
        }
        const onSave = (record) => {
            serverCache.getDraft(record.id);
            this.setState({dirty:false});
        }
        serverCache.patchRecord(this.props.record.get('id'), patch,
                    this.isSubmittedSet() ? onSaveAndPublish : onSave);
    },

    isSubmittedSet() {
        return this.state.record.get('publication_state') == 'submitted';
    },

    setPublishedState(e) {
        const state = e.target.checked ? 'submitted' : 'draft';
        const record = this.state.record.set('publication_state', state);
        this.setState({record});
    },

    render() {
        const rootSchema = this.props.rootSchema;
        const blockSchemas = this.props.blockSchemas;
        if (!this.state.record || !rootSchema) {
            return <Wait/>;
        }
        return (
            <div className="edit-record">
                <div className="row">
                    <div className="col-xs-12">
                        <h2 className="name">
                            <span style={{color:'#aaa'}}>Editing </span>
                            {this.state.record.get('title')}
                        </h2>
                    </div>
                </div>
                <div style={{position:'relative', width:'100%'}}>
                    <div style={{position:'absolute', width:'100%', zIndex:1}}>
                        { this.state.modal }
                    </div>
                </div>
                <div className="row">
                    <div className="col-xs-12">
                        { this.renderFileBlock() }
                    </div>
                    <div className="col-xs-12">
                        <form className="form-horizontal" onSubmit={this.updateRecord}>
                            { this.renderFieldBlock(null, rootSchema) }

                            { !blockSchemas ? false :
                                blockSchemas.map(([id, blockSchema]) =>
                                    this.renderFieldBlock(id, (blockSchema||Map()).get('json_schema'))) }
                        </form>
                    </div>
                </div>
                <div className="row">
                    <div className="form-group submit row" style={{marginTop:'2em', marginBottom:'2em', paddingTop:'2em', borderTop:'1px solid #eee'}}>
                        {pairs(this.state.errors).map( ([id, msg]) =>
                            <div className="col-sm-offset-3 col-sm-6 alert alert-warning" key={id}>{msg} </div>) }
                        <div className="col-sm-offset-3 col-sm-6">
                            <label style={{fontSize:18, fontWeight:'normal'}}>
                                <input type="checkbox" value={this.isSubmittedSet} onChange={this.setPublishedState}/>
                                {" "}Submit draft for publication
                            </label>
                            <p>When the draft is published it will be assigned a PID, making it publicly citable.
                                But a published record's files can no longer be modified by its owner. </p>
                            {   this.isSubmittedSet() ?
                                    <button type="submit" className="btn btn-primary btn-default btn-block btn-danger" onClick={this.updateRecord}>
                                        Save and Publish </button>
                                : this.state.dirty ?
                                    <button type="submit" className="btn btn-primary btn-default btn-block" onClick={this.updateRecord}>
                                        Save Draft </button>
                                  : <button type="submit" className="btn btn-default btn-block disabled">
                                        The draft is up to date </button>
                            }
                        </div>
                    </div>
                </div>
            </div>
        );
    }
});

///////////////////////////////////////////////////////////////////////////////

function renderSmallCommunity(community, active, onClickFn) {
    const activeClass = active ? " active": " inactive";
    if (!community || community instanceof Error) {
        return false;
    }
    return (
        <a href="#" key={community.get('id')}
                className={"community-small" + activeClass} title={community.get('description')}
                onClick={onClickFn ? onClickFn : ()=>{}}>
            <p className="name">{community.get('name')}</p>
            <img className="logo" src={community.get('logo')}/>
        </a>
    );
}
