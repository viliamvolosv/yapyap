// StorageModule: thin wrapper over DatabaseManager

import type { YapYapNodeOptions } from "../core/node.js";
import { ContactsDatabase } from "../database/domains/ContactsDatabase.js";
import { MessageQueueDatabase } from "../database/domains/MessageQueueDatabase.js";
import { NodeKeysDatabase } from "../database/domains/NodeKeysDatabase.js";
import { PeerMetadataDatabase } from "../database/domains/PeerMetadataDatabase.js";
import { RoutingCacheDatabase } from "../database/domains/RoutingCacheDatabase.js";
import { SearchDatabase } from "../database/domains/SearchDatabase.js";
import { SessionDatabase } from "../database/domains/SessionDatabase.js";
import { DatabaseManager } from "../database/index.js";

export class StorageModule {
	private dbManager: DatabaseManager;
	private contactsDb!: ContactsDatabase;
	private messageQueueDb!: MessageQueueDatabase;
	private routingCacheDb!: RoutingCacheDatabase;
	private sessionDb!: SessionDatabase;
	private nodeKeysDb!: NodeKeysDatabase;
	private peerMetadataDb!: PeerMetadataDatabase;
	private searchDb!: SearchDatabase;

	constructor(options: YapYapNodeOptions) {
		this.dbManager = new DatabaseManager(options);
		const db = this.dbManager.getDatabase();
		this.contactsDb = new ContactsDatabase(db);
		this.messageQueueDb = new MessageQueueDatabase(db);
		this.routingCacheDb = new RoutingCacheDatabase(db);
		this.sessionDb = new SessionDatabase(db);
		this.nodeKeysDb = new NodeKeysDatabase(db);
		this.peerMetadataDb = new PeerMetadataDatabase(db);
		this.searchDb = new SearchDatabase(db);
	}

	async close() {
		await this.dbManager.close();
	}

	// High-level accessors
	get contacts() {
		return this.contactsDb;
	}
	get messages() {
		return this.messageQueueDb;
	}
	get routing() {
		return this.routingCacheDb;
	}
	get sessions() {
		return this.sessionDb;
	}
	get keys() {
		return this.nodeKeysDb;
	}
	get metadata() {
		return this.peerMetadataDb;
	}
	get search() {
		return this.searchDb;
	}
	get manager() {
		return this.dbManager;
	}
}
