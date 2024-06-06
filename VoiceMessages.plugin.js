/**
 * @name VoiceMessages
 * @author Riolubruh
 * @version 0.0.2
 * @invite EFmGEWAUns
 * @source https://github.com/riolubruh/VoiceMessages
 * @updateUrl https://raw.githubusercontent.com/riolubruh/VoiceMessages/main/VoiceMessages.plugin.js
 */
/*@cc_on
@if(@_jscript)
	
	// Offer to self-install for clueless users that try to run this directly.
	var shell = WScript.CreateObject("WScript.Shell");
	var fs = new ActiveXObject("Scripting.FileSystemObject");
	var pathPlugins = shell.ExpandEnvironmentStrings("%APPDATA%\\BetterDiscord\\plugins");
	var pathSelf = WScript.ScriptFullName;
	// Put the user at ease by addressing them in the first person
	shell.Popup("It looks like you've mistakenly tried to run me directly. \n(Don't do that!)", 0, "I'm a plugin for BetterDiscord", 0x30);
	if(fs.GetParentFolderName(pathSelf) === fs.GetAbsolutePathName(pathPlugins)) {
		shell.Popup("I'm in the correct folder already.", 0, "I'm already installed", 0x40);
	} else if(!fs.FolderExists(pathPlugins)) {
		shell.Popup("I can't find the BetterDiscord plugins folder.\nAre you sure it's even installed?", 0, "Can't install myself", 0x10);
	} else if(shell.Popup("Should I copy myself to BetterDiscord's plugins folder for you?", 0, "Do you need some help?", 0x34) === 6) {
		fs.CopyFile(pathSelf, fs.BuildPath(pathPlugins, fs.GetFileName(pathSelf)), true);
		// Show the user where to put plugins in the future
		shell.Exec("explorer " + pathPlugins);
		shell.Popup("I'm installed!", 0, "Successfully installed", 0x40);
	}
	WScript.Quit();

@else@*/

/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const { React, Webpack, UI, Patcher } = BdApi;
const { createElement, useState, useEffect, useMemo } = React;
const ReactUtils = Webpack.getByKeys("openModalLazy");
const { DiscordModules, WebpackModules, DiscordClasses, Toasts } = ZLibrary;
const CloudUploader = WebpackModules.getByProps("CloudUpload", "CloudUploadStatus");
const EMPTY_META = {
	waveform: "AAAAAAAAAAAA",
	duration: 1,
};
const fs = require("fs");

function useObjectUrl() {
	const [url, setUrl] = useState("");
	const setWithFree = (blob) => {
		if (url)
			URL.revokeObjectURL(url);
		setUrl(URL.createObjectURL(blob));
	};

	return [url, setWithFree];
}

function useAwaiter(factory, providedOpts) {
	const opts = Object.assign({
		fallbackValue: null,
		deps: [],
		onError: null,
	}, providedOpts);
	const [state, setState] = useState({
		value: opts.fallbackValue,
		error: null,
		pending: true
	});

	useEffect(() => {
		let isAlive = true;
		if (!state.pending) setState({ ...state, pending: true });

		factory()
			.then(value => {
				if (!isAlive) return;
				setState({ value, error: null, pending: false });
				opts.onSuccess?.(value);
			})
			.catch(error => {
				if (!isAlive) return;
				setState({ value: null, error, pending: false });
				opts.onError?.(error);
			});

		return () => void (isAlive = false);
	}, opts.deps);

	return [state.value, state.error, state.pending];
}

const discordVoice = DiscordNative.nativeModules.requireModule("discord_voice");

function VoiceRecorder({ setAudioBlob, onRecordingChange }) {
	const [recording, setRecording] = useState(false);

	const changeRecording = (recording) => {
		setRecording(recording);
		onRecordingChange?.(recording);
	};

	function readRecording(filePath) {
		try {
			filePath = filePath.replaceAll("/", "\\");
			filePath = filePath.replaceAll(`\\`, `\\\\`);
			const buf = fs.readFileSync(filePath, "", function (err) {
				Logger.err("VoiceMessages", err);
			});
			return new Uint8Array(buf);
		} catch (err) {
			Logger.err("VoiceMessages", err);
			return null;
		}
	}

	function toggleRecording() {
		const nowRecording = !recording;

		if (nowRecording) {
			discordVoice.startLocalAudioRecording(
				{
					echoCancellation: DiscordModules.VoiceInfo.getEchoCancellation(),
					noiseCancellation: DiscordModules.VoiceInfo.getNoiseSuppression,
				},
				(success) => {
					if (success) {
						changeRecording(true);

					} else
						UI.showToast("Failed to start recording", Toasts.ToastTypes.error);
				}
			);
		} else {
			discordVoice.stopLocalAudioRecording(async filePath => {
				if (filePath) {
					const buf = readRecording(filePath);
					if (buf) {
						setAudioBlob(new Blob([buf], { type: "audio/ogg; codecs=opus" }));
					}
					else
						UI.showToast("Failed to finish recording", Toasts.ToastTypes.error);
				}
				changeRecording(false);
			});
		}
	}

	return createElement(ReactUtils.Button, {
		id: "toggleRecordingButton",
		onClick: () => {
			toggleRecording();
		},
		children: `${recording ? "Stop" : "Start"} recording`,
		style: {
			marginTop: "10px"
		}
	}
	);
};

const VoiceMessage = Webpack.getByKeys("renderVoiceMessageAudioComponent").renderVoiceMessageAudioComponent;

function useTimer({ interval = 1000, deps = [] }) {
	const [time, setTime] = useState(0);
	const start = useMemo(() => Date.now(), deps);

	useEffect(() => {
		const intervalId = setInterval(() => setTime(Date.now() - start), interval);

		return () => {
			setTime(0);
			clearInterval(intervalId);
		};
	}, deps);

	return time;
}

function VoicePreview({ src, waveform, recording }) {
	if (!waveform) waveform = EMPTY_META.waveform;
	const durationMs = useTimer({
		deps: [recording]
	});

	const durationSeconds = recording ? Math.floor(durationMs / 1000) : 0;
	const durationDisplay = Math.floor(durationSeconds / 60) + ":" + (durationSeconds % 60).toString().padStart(2, "0");

	if (src && !recording) {
		return createElement("div", {
			children: createElement(VoiceMessage, {
				key: src,
				"src": src,
				"waveform": waveform,
				durationSecs: durationSeconds
			})
		});
	}

	return createElement("div", {
		className: (() => { return ("vc-vmsg-preview" + (recording ? " vc-vmsg-preview-recording" : "")) })(),
		children: [
			createElement("div", {
				className: "vc-vmsg-preview-indicator",
			}),
			createElement("div", {
				className: "vc-vmsg-preview-time",
				children: durationDisplay
			}),
			createElement("div", {
				className: "vc-vmsg-preview-label",
				children: (() => { return (recording ? "RECORDING" : "----") })()
			})
		]
	});
}

function chooseFile(mimeTypes) {
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file";
		input.style.display = "none";
		input.accept = mimeTypes;
		input.onchange = async () => {
			resolve(input.files?.[0] ?? null);
		};

		document.body.appendChild(input);
		input.click();
		setImmediate(() => document.body.removeChild(input));
	});
}

const Constants = WebpackModules.getByProps("Endpoints");
const MessageActions = WebpackModules.getByProps("getSendMessageOptionsForReply");

function Icon({ height = 24, width = 24, className, children, viewBox, ...svgProps }) {
	return createElement("svg", {
		className: `${className} vc-icon`,
		role: "img",
		width,
		height,
		viewBox,
		...svgProps,
		children
	})
}

function Microphone(props) {
	return createElement(Icon, {
		...props,
		className: `${props.className} vc-microphone`,
		viewBox: "0 0 24 24",
		children: [
			createElement("path", {
				fillRule: "evenodd",
				clipRule: "evenodd",
				d: "M14.99 11C14.99 12.66 13.66 14 12 14C10.34 14 9 12.66 9 11V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5L14.99 11ZM12 16.1C14.76 16.1 17.3 14 17.3 11H19C19 14.42 16.28 17.24 13 17.72V21H11V17.72C7.72 17.23 5 14.41 5 11H6.7C6.7 14 9.24 16.1 12 16.1ZM12 4C11.2 4 11 4.66667 11 5V11C11 11.3333 11.2 12 12 12C12.8 12 13 11.3333 13 11V5C13 4.66667 12.8 4 12 4Z",
				fill: "currentColor"
			}),
			createElement("path", {
				fillRule: "evenodd",
				clipRule: "evenodd",
				d: "M14.99 11C14.99 12.66 13.66 14 12 14C10.34 14 9 12.66 9 11V5C9 3.34 10.34 2 12 2C13.66 2 15 3.34 15 5L14.99 11ZM12 16.1C14.76 16.1 17.3 14 17.3 11H19C19 14.42 16.28 17.24 13 17.72V22H11V17.72C7.72 17.23 5 14.41 5 11H6.7C6.7 14 9.24 16.1 12 16.1Z",
				fill: "currentColor"
			})
		]
	})
}

const dispatcher = Webpack.getByKeys("dispatch", "subscribe");

async function sendAudio(blob, meta) {
	if (!blob) return;
	if (!meta) meta = EMPTY_META;

	if (blob.size == 0) {
		UI.showToast("Voice message data was empty. Aborted upload.", Toasts.ToastTypes.error);
		return;
	}

	const channelId = Webpack.getStore("SelectedChannelStore").getCurrentlySelectedChannelId();
	const reply = Webpack.getStore("PendingReplyStore").getPendingReply(channelId);
	if (reply) dispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });

	const upload = new CloudUploader.CloudUpload({
		file: new File([blob], "voice-message.ogg", { type: "audio/ogg; codecs=opus" }),
		isClip: false,
		isThumbnail: false,
		platform: 1,
	}, channelId, false, 0);

	upload.on("complete", () => {
		WebpackModules.getByProps("HTTP").HTTP.post({
			url: Constants.Endpoints.MESSAGES(channelId),
			body: {
				flags: 1 << 13,
				channel_id: channelId,
				content: "",
				nonce: Date.now(),
				sticker_ids: [],
				type: 0,
				attachments: [{
					id: "0",
					filename: upload.filename,
					uploaded_filename: upload.uploadedFilename,
					waveform: meta.waveform,
					duration_secs: meta.duration
				}],
				message_reference: reply ? MessageActions.getSendMessageOptionsForReply(reply)?.messageReference : null,
			}
		});
	})
	upload.on("error", () => UI.showToast("Failed to upload voice message", Toasts.ToastTypes.error));

	upload.upload();
}

const OptionClasses = Webpack.getByKeys("optionLabel");
const PermissionStore = Webpack.getStore("PermissionStore");
const PopoutMenuModule = WebpackModules.getAllByProps("default").filter(obj => obj.default.toString().includes("Send Attachment"))[0];

module.exports = (() => {
	const config = {
		"info": {
			"name": "VoiceMessages",
			"authors": [{
				"name": "Riolubruh",
				"discord_id": "359063827091816448",
				"github_username": "riolubruh"
			}],
			"version": "0.0.2",
			"description": "Unlock all screensharing modes, and use cross-server & GIF emotes!",
			"github": "https://github.com/riolubruh/VoiceMessages",
			"github_raw": "https://raw.githubusercontent.com/riolubruh/VoiceMessages/main/VoiceMessages.plugin.js"
		},
		changelog: [
			{
				title: "0.0.2",
				items: [
					"Added the option to disable calculating the metadata for an audio file."
				]
			}
		],
		"main": "VoiceMessages.plugin.js"
	};

	return !global.ZeresPluginLibrary ? class {
		constructor() {
			this._config = config;
		}
		getName() {
			return config.info.name;
		}
		getAuthor() {
			return config.info.authors.map(a => a.name).join(", ");
		}
		getDescription() {
			return config.info.description;
		}
		getVersion() {
			return config.info.version;
		}
		load() {
			UI.showConfirmationModal("Library Missing", `The library plugin needed for ${config.info.name} is missing. Please click Download Now to install it.`, {
				confirmText: "Download Now",
				cancelText: "Cancel",
				onConfirm: () => {
					require("request").get("https://rauenzi.github.io/BDPluginLibrary/release/0PluginLibrary.plugin.js", async (error, response, body) => {
						if (error) return require("electron").shell.openExternal("https://raw.githubusercontent.com/rauenzi/BDPluginLibrary/master/release/0PluginLibrary.plugin.js");
						await new Promise(r => require("fs").writeFile(require("path").join(BdApi.Plugins.folder, "0PluginLibrary.plugin.js"), body, r));
					});
				}
			});
		}
		start() { }
		stop() { }
	} : (([Plugin, Api]) => {
		const plugin = (Plugin, Api) => {
			const {
				DiscordModules,
				Settings,
				Toasts,
				Utilities,
				WebpackModules,
				DiscordClassModules,
				DiscordClasses,
				PluginUpdater,
				Logger,
				ContextMenu,
				Modals
			} = Api;
			return class VoiceMessages extends Plugin {
				defaultSettings = {
					"skipMetadata": false
				}
				getSettingsPanel() {
					return Settings.SettingPanel.build(_ => this.saveAndUpdate(), ...[
						new Settings.Switch("Skip Metadata Calculation", "Skips processing the metadata of the audio file. Prevents a crash when attempting to upload really long audio files, but causes a flat waveform.", this.settings.skipMetadata, value => this.settings.skipMetadata = value),
					])
				}

				settings = Utilities.loadSettings(this.getName(), this.defaultSettings);

				saveAndUpdate() { //Saves and updates settings and runs functions
					Utilities.saveSettings(this.getName(), this.settings);
					BdApi.Patcher.unpatchAll(this.getName());
					this.patchPopoutMenu();
				}

				VoiceMessageModal({ modalProps, shouldSkipMetadata }) {
					const [isRecording, setRecording] = useState(false);
					const [blob, setBlob] = useState();
					const [blobUrl, setBlobUrl] = useObjectUrl();

					useEffect(() => () => {
						if (blobUrl)
							URL.revokeObjectURL(blobUrl);
					}, [blobUrl]);

					const [meta] = useAwaiter(async () => {
						if (!blob) return EMPTY_META;
						if (shouldSkipMetadata) {
							return EMPTY_META;
						}
						const audioContext = new AudioContext();
						const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
						const channelData = audioBuffer.getChannelData(0);

						const clamp = (num, min, max) => Math.min(Math.max(num, min), max)
						// average the samples into much lower resolution bins, maximum of 256 total bins
						const bins = new Uint8Array(clamp(Math.floor(audioBuffer.duration * 10), Math.min(32, channelData.length), 256));
						const samplesPerBin = Math.floor(channelData.length / bins.length);

						// Get root mean square of each bin
						for (let binIdx = 0; binIdx < bins.length; binIdx++) {
							let squares = 0;
							for (let sampleOffset = 0; sampleOffset < samplesPerBin; sampleOffset++) {
								const sampleIdx = binIdx * samplesPerBin + sampleOffset;
								squares += channelData[sampleIdx] ** 2;
							}
							bins[binIdx] = ~~(Math.sqrt(squares / samplesPerBin) * 0xFF);
						}

						// Normalize bins with easing
						const maxBin = Math.max(...bins);
						const ratio = 1 + (0xFF / maxBin - 1) * Math.min(1, 100 * (maxBin / 0xFF) ** 3);
						for (let i = 0; i < bins.length; i++) bins[i] = Math.min(0xFF, ~~(bins[i] * ratio));

						return {
							waveform: window.btoa(String.fromCharCode(...bins)),
							duration: audioBuffer.duration,
						};
					}, {
						deps: [blob],
						fallbackValue: EMPTY_META,
					});

					const isUnsupportedFormat = blob && (
						!blob.type.startsWith("audio/ogg")
						|| blob.type.includes("codecs") && !blob.type.includes("opus")
					);

					return createElement(ReactUtils.ModalRoot, {
						transitionState: ReactUtils.ModalTransitionState.ENTERING,
						children: [
							createElement(ReactUtils.ModalHeader, {
								children: [
									createElement(ReactUtils.FormTitle, {
										children: "Record Voice Message"
									})
								]
							}),
							createElement(ReactUtils.ModalContent, {
								className: "vc-vmsg-modal",
								children: [
									createElement("div", {
										className: "vc-vmsg-buttons",
										children: [
											createElement(VoiceRecorder, {
												setAudioBlob: (blob) => {
													setBlob(blob);
													setBlobUrl(blob);
												},
												onRecordingChange: setRecording
											}),
											createElement(ReactUtils.Button, {
												onClick: async () => {
													const file = await chooseFile("audio/*");
													if (file) {
														setBlob(file);
														setBlobUrl(file);
													}
												},
												children: "Upload File",
												style: {
													marginTop: "10px"
												}
											})
										]
									}),
									createElement(ReactUtils.FormTitle, { children: "Preview" }),
									createElement(VoicePreview, {
										src: blobUrl,
										waveform: meta?.waveform,
										recording: isRecording
									}),
									(() => {
										if (isUnsupportedFormat) {
											return createElement(ReactUtils.Card, {
												className: `vc-plugins-restart-card ${DiscordClasses.Margins.marginTop20}`,
												children: [
													createElement(ReactUtils.FormText, {
														children: `Voice Messages have to be OggOpus to be playable on iOS. This file is ${blob.type} so it will not be playable on iOS.`
													}),
													createElement(ReactUtils.FormText, {
														className: DiscordClasses.Margins.marginTop8,
														children: [
															`To fix it, first convert it to OggOpus, for example using the `,
															createElement(ReactUtils.Anchor, {
																href: "https://convertio.co/mp3-opus/",
																children: "convertio web converter"
															})
														]
													})
												]
											})
										}
									})()
								]
							}),
							createElement(ReactUtils.ModalFooter, {
								children: [
									createElement(ReactUtils.Button, {
										disabled: !blob,
										onClick: async () => {
											modalProps.onClose();
											sendAudio(blob, meta);
											UI.showToast("Now sending voice message... Please be patient", Toasts.ToastTypes.info.MESSAGE);
										},
										children: "Send"
									})
								]
							})
						]
					})
				}

				patchPopoutMenu() {
					Patcher.after(this.getName(), PopoutMenuModule, "default", (_, [args], ret) => {
						//											  SEND_VOICE_MESSAGES											 SEND_MESSAGES
						if (args.channel.guild_id && !(PermissionStore.can(1n << 46n, args.channel) && PermissionStore.can(1n << 11n, args.channel)))
							return;

						ret.props.children.push(ContextMenu.buildMenuItem({
							id: "vc-send-vmsg",
							label: createElement("div", {
								className: OptionClasses.optionLabel,
								children: [
									//microphone icon
									createElement(Microphone, {
										className: OptionClasses.optionIcon,
										height: 24,
										width: 24
									}),
									//option name
									createElement("div", {
										className: OptionClasses.optionName,
										children: "Send voice message"
									})
								]
							}),
							action: () => {
								ReactUtils.openModal(modalProps => createElement(this.VoiceMessageModal, { modalProps, shouldSkipMetadata: this.settings.skipMetadata }), {
									onCloseCallback: () => {
										//ensure we stop recording if the user suddenly closes the modal without pressing stop
										discordVoice.stopLocalAudioRecording(filePath => { return; })
									}
								});
							}
						}))
					});
				}


				onStart() {
					Patcher.unpatchAll(this.getName())
					this.patchPopoutMenu();
					BdApi.DOM.addStyle(this.getName(), `
						.vc-vmsg-modal {
							padding: 1em;
						}
						
						.vc-vmsg-buttons {
							display: grid;
							grid-template-columns: repeat(3, minmax(0, 1fr));
							gap: 0.5em;
							margin-bottom: 1em;
						}
						
						.vc-vmsg-modal audio {
							width: 100%;
						}
						
						.vc-vmsg-preview {
							color: var(--text-normal);
							border-radius: 24px;
							background-color: var(--background-secondary);
							position: relative;
							display: flex;
							align-items: center;
							padding: 0 16px;
							height: 48px;
						}
						
						.vc-vmsg-preview-indicator {
							background: var(--button-secondary-background);
							width: 16px;
							height: 16px;
							border-radius: 50%;
							transition: background 0.2s ease-in-out;
						}
						
						.vc-vmsg-preview-recording .vc-vmsg-preview-indicator {
							background: var(--status-danger);
						}
						
						.vc-vmsg-preview-time {
							opacity: 0.8;
							margin: 0 0.5em;
							font-size: 80%;
						
							/* monospace so different digits have same size */
							font-family: var(--font-code);
						}
						
						.vc-vmsg-preview-label {
							opacity: 0.5;
							letter-spacing: 0.125em;
							font-weight: 600;
							flex: 1;
							text-align: center;
						}
					`)
				}

				onStop() {
					Patcher.unpatchAll(this.getName());
					BdApi.DOM.removeStyle(this.getName());
				}


			};
		};
		return plugin(Plugin, Api);
	})(global.ZeresPluginLibrary.buildPlugin(config));
})();
/*@end@*/
