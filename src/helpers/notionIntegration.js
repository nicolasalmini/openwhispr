const { NotionOAuth } = require("./notionOAuth");
const { NotionClient, dataSourceTitle, findTitleProperty } = require("./notionClient");
const { NotionPublicationService } = require("./notionPublicationService");

class NotionIntegration {
  constructor(databaseManager, options = {}) {
    this.databaseManager = databaseManager;
    this.oauth = new NotionOAuth(databaseManager, options);
    this.client = new NotionClient(this.oauth, options);
    this.publications = new NotionPublicationService(databaseManager, this.client);
  }

  startOAuth() {
    return this.oauth.start();
  }

  handleDeepLink(url) {
    return this.oauth.handleDeepLink(url);
  }

  getStatus() {
    return this.oauth.getStatus();
  }

  disconnect() {
    return this.oauth.disconnect();
  }

  async searchDataSources(query = "") {
    const connection = this.databaseManager.getNotionConnection();
    if (!connection) throw new Error("Connect Notion first");
    return this.client.searchDataSources(connection.id, query);
  }

  async saveDestination(input) {
    const connection = this.databaseManager.getNotionConnection();
    if (!connection) throw new Error("Connect Notion first");
    const schema = input.dataSourceId
      ? await this.client.retrieveDataSource(connection.id, input.dataSourceId)
      : await this.client.resolveDataSource(connection.id, input.databaseUrlOrId);
    findTitleProperty(schema);
    return this.databaseManager.saveNotionDestination({
      connectionId: connection.id,
      dataSourceId: schema.id,
      databaseId: schema.parent?.database_id || input.databaseId || null,
      dataSourceName: input.dataSourceName || dataSourceTitle(schema),
      schemaSnapshot: schema,
      layoutKey: input.layoutKey || "general",
      includeTranscript: input.includeTranscript === true,
    });
  }

  async refreshDestination() {
    const destination = this.databaseManager.getNotionDestination();
    const connection = this.databaseManager.getNotionConnection(destination?.connection_id);
    if (!destination || !connection) throw new Error("Choose a Notion destination first");
    const schema = await this.client.retrieveDataSource(connection.id, destination.data_source_id);
    findTitleProperty(schema);
    return this.databaseManager.saveNotionDestination({
      connectionId: connection.id,
      dataSourceId: schema.id,
      databaseId: schema.parent?.database_id || destination.database_id,
      dataSourceName: dataSourceTitle(schema) || destination.data_source_name,
      schemaSnapshot: schema,
      layoutKey: destination.layout_key,
      includeTranscript: destination.include_transcript === 1,
    });
  }

  updateDestinationSettings(settings) {
    const destination = this.databaseManager.getNotionDestination();
    if (!destination) throw new Error("Choose a Notion destination first");
    return this.databaseManager.saveNotionDestination({
      connectionId: destination.connection_id,
      dataSourceId: destination.data_source_id,
      databaseId: destination.database_id,
      dataSourceName: destination.data_source_name,
      schemaSnapshot: destination.schema_snapshot,
      layoutKey: settings.layoutKey || destination.layout_key,
      includeTranscript:
        settings.includeTranscript === undefined
          ? destination.include_transcript === 1
          : settings.includeTranscript,
    });
  }

  previewPublication(noteId, options) {
    return this.publications.preview(noteId, options);
  }

  publish(noteId, options) {
    return this.publications.publish(noteId, options);
  }

  getPublicationStatus(noteId) {
    return this.publications.getStatus(noteId);
  }
}

module.exports = NotionIntegration;
